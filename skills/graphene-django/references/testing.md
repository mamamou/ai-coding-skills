---
title: GraphQL Testing Patterns
description: Testing graphene-django APIs with Django test client, snapshot testing, fixtures, and query validation
tags: graphene-django, testing, django-test, snapshot, fixtures, assertnumqueries
---

# GraphQL Testing Patterns

## Test Client Setup

### Basic GraphQL Test Mixin

```python
import json
from django.test import TestCase, Client

class GraphQLTestCase(TestCase):
    """Base test case for GraphQL queries and mutations."""

    GRAPHQL_URL = "/graphql/"

    def setUp(self):
        self.client = Client()

    def query(self, query, variables=None, operation_name=None, headers=None):
        """Execute a GraphQL query and return parsed response."""
        body = {"query": query}
        if variables:
            body["variables"] = variables
        if operation_name:
            body["operationName"] = operation_name

        kwargs = {
            "data": json.dumps(body),
            "content_type": "application/json",
        }
        if headers:
            kwargs.update(headers)

        response = self.client.post(self.GRAPHQL_URL, **kwargs)
        content = json.loads(response.content)
        return content

    def assertNoErrors(self, response):
        """Assert that the GraphQL response has no errors."""
        self.assertNotIn("errors", response, f"GraphQL errors: {response.get('errors')}")

    def assertHasErrors(self, response, count=None):
        """Assert that the GraphQL response has errors."""
        self.assertIn("errors", response)
        if count is not None:
            self.assertEqual(len(response["errors"]), count)
```

### Authenticated Test Helper

```python
from django.contrib.auth import get_user_model

User = get_user_model()

class AuthenticatedGraphQLTestCase(GraphQLTestCase):

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="testuser", password="testpass123"
        )
        self.staff_user = User.objects.create_superuser(
            username="admin", password="adminpass123"
        )

    def query_as(self, user, query, variables=None):
        """Execute a query as a specific user."""
        self.client.force_login(user)
        result = self.query(query, variables)
        self.client.logout()
        return result

    def query_as_user(self, query, variables=None):
        return self.query_as(self.user, query, variables)

    def query_as_staff(self, query, variables=None):
        return self.query_as(self.staff_user, query, variables)

    def query_anonymous(self, query, variables=None):
        self.client.logout()
        return self.query(query, variables)
```

## Testing Schema via execute()

Bypass HTTP — execute directly against the schema for unit tests:

```python
from myapp.schema import schema

class SchemaTest(TestCase):
    def test_all_books_query(self):
        Book.objects.create(title="Test Book", author=self.author)

        result = schema.execute(
            """
            query {
                allBooks {
                    edges {
                        node {
                            title
                            author { name }
                        }
                    }
                }
            }
            """,
            context_value=self.make_context(),
        )

        self.assertIsNone(result.errors)
        books = result.data["allBooks"]["edges"]
        self.assertEqual(len(books), 1)
        self.assertEqual(books[0]["node"]["title"], "Test Book")

    def make_context(self, user=None):
        """Create a mock request context."""
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.get("/graphql/")
        request.user = user or self.user
        return request
```

## Query Testing Patterns

### Testing Relay Connections

```python
class BookConnectionTest(GraphQLTestCase):
    def setUp(self):
        super().setUp()
        self.author = Author.objects.create(name="Author")
        for i in range(25):
            Book.objects.create(title=f"Book {i}", author=self.author)

    def test_first_page(self):
        response = self.query("""
            query {
                allBooks(first: 10) {
                    edges {
                        node { title }
                        cursor
                    }
                    pageInfo {
                        hasNextPage
                        hasPreviousPage
                        endCursor
                    }
                    totalCount
                }
            }
        """)
        self.assertNoErrors(response)
        data = response["data"]["allBooks"]
        self.assertEqual(len(data["edges"]), 10)
        self.assertTrue(data["pageInfo"]["hasNextPage"])
        self.assertFalse(data["pageInfo"]["hasPreviousPage"])
        self.assertEqual(data["totalCount"], 25)

    def test_pagination_forward(self):
        # Get first page
        first_page = self.query("""
            query { allBooks(first: 10) { pageInfo { endCursor } edges { node { title } } } }
        """)
        end_cursor = first_page["data"]["allBooks"]["pageInfo"]["endCursor"]

        # Get second page using cursor
        second_page = self.query("""
            query ($after: String!) {
                allBooks(first: 10, after: $after) {
                    edges { node { title } }
                    pageInfo { hasNextPage endCursor }
                }
            }
        """, variables={"after": end_cursor})

        self.assertNoErrors(second_page)
        edges = second_page["data"]["allBooks"]["edges"]
        self.assertEqual(len(edges), 10)

        # Ensure no overlap between pages
        first_titles = {e["node"]["title"] for e in first_page["data"]["allBooks"]["edges"]}
        second_titles = {e["node"]["title"] for e in edges}
        self.assertEqual(len(first_titles & second_titles), 0)

    def test_filtering(self):
        Book.objects.create(title="Django Unleashed", author=self.author)

        response = self.query("""
            query {
                allBooks(title_Icontains: "django") {
                    edges { node { title } }
                }
            }
        """)
        self.assertNoErrors(response)
        edges = response["data"]["allBooks"]["edges"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["node"]["title"], "Django Unleashed")
```

### Testing Mutations

```python
class CreateBookMutationTest(AuthenticatedGraphQLTestCase):
    def setUp(self):
        super().setUp()
        self.author = Author.objects.create(name="Author")

    def test_create_book(self):
        response = self.query_as_user("""
            mutation ($input: CreateBookInput!) {
                createBook(input: $input) {
                    book {
                        id
                        title
                        author { name }
                    }
                    errors { field messages }
                    ok
                }
            }
        """, variables={
            "input": {
                "title": "New Book",
                "authorId": self.author.pk,
            }
        })
        self.assertNoErrors(response)
        data = response["data"]["createBook"]
        self.assertTrue(data["ok"])
        self.assertEqual(data["book"]["title"], "New Book")
        self.assertEqual(data["errors"], [])

        # Verify in database
        self.assertTrue(Book.objects.filter(title="New Book").exists())

    def test_create_book_validation_error(self):
        response = self.query_as_user("""
            mutation ($input: CreateBookInput!) {
                createBook(input: $input) {
                    book
                    errors { field messages }
                    ok
                }
            }
        """, variables={
            "input": {
                "title": "",  # required field
                "authorId": self.author.pk,
            }
        })
        data = response["data"]["createBook"]
        self.assertFalse(data["ok"])
        self.assertIsNone(data["book"])
        self.assertTrue(len(data["errors"]) > 0)

    def test_create_book_unauthenticated(self):
        response = self.query_anonymous("""
            mutation {
                createBook(input: {title: "Book", authorId: 1}) {
                    ok
                }
            }
        """)
        self.assertHasErrors(response)
```

## N+1 Query Testing

```python
class QueryPerformanceTest(GraphQLTestCase):
    def setUp(self):
        super().setUp()
        for i in range(20):
            author = Author.objects.create(name=f"Author {i}")
            for j in range(5):
                Book.objects.create(title=f"Book {j}", author=author)

    def test_all_authors_with_books_no_n_plus_one(self):
        """Ensure nested book resolution doesn't cause N+1."""
        query = """
            query {
                allAuthors {
                    edges {
                        node {
                            name
                            books { title }
                        }
                    }
                }
            }
        """
        # Expect: 1 query for authors + 1 query for all books (batched)
        with self.assertNumQueries(2):
            response = self.query(query)

        self.assertNoErrors(response)
        authors = response["data"]["allAuthors"]["edges"]
        self.assertEqual(len(authors), 20)

    def test_single_book_with_author_constant_queries(self):
        """Single-object lookup should use constant queries regardless of data size."""
        book = Book.objects.first()
        query = """
            query ($id: ID!) {
                book(id: $id) { title author { name } }
            }
        """
        with self.assertNumQueries(2):  # 1 book + 1 author (or 1 with select_related)
            self.query(query, variables={"id": book.pk})
```

## Authorization Testing

```python
class AuthorizationTest(AuthenticatedGraphQLTestCase):
    def test_staff_sees_all_books(self):
        Book.objects.create(title="Draft", status="draft", author=self.author)
        Book.objects.create(title="Published", status="published", author=self.author)

        response = self.query_as_staff("""
            { allBooks { edges { node { title status } } } }
        """)
        self.assertEqual(len(response["data"]["allBooks"]["edges"]), 2)

    def test_user_sees_only_published(self):
        Book.objects.create(title="Draft", status="draft", author=self.author)
        Book.objects.create(title="Published", status="published", author=self.author)

        response = self.query_as_user("""
            { allBooks { edges { node { title status } } } }
        """)
        edges = response["data"]["allBooks"]["edges"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["node"]["title"], "Published")

    def test_anonymous_cannot_access_protected_query(self):
        response = self.query_anonymous("""
            { allUsers { edges { node { username email } } } }
        """)
        self.assertHasErrors(response)

    def test_field_level_auth(self):
        """Internal notes hidden from non-staff."""
        Book.objects.create(
            title="Book", status="published",
            internal_notes="Secret", author=self.author,
        )

        staff_response = self.query_as_staff("""
            { allBooks { edges { node { title internalNotes } } } }
        """)
        user_response = self.query_as_user("""
            { allBooks { edges { node { title internalNotes } } } }
        """)

        self.assertEqual(
            staff_response["data"]["allBooks"]["edges"][0]["node"]["internalNotes"],
            "Secret",
        )
        self.assertIsNone(
            user_response["data"]["allBooks"]["edges"][0]["node"]["internalNotes"],
        )
```

## Schema Validation Testing

```python
from graphql import build_ast_schema, parse

class SchemaValidationTest(TestCase):
    def test_schema_is_valid(self):
        """Ensure schema builds without errors."""
        from myapp.schema import schema
        # This will raise if the schema is invalid
        introspection = schema.execute("{ __schema { types { name } } }")
        self.assertIsNone(introspection.errors)

    def test_expected_types_exist(self):
        from myapp.schema import schema
        result = schema.execute("""
            { __schema { types { name } } }
        """)
        type_names = {t["name"] for t in result.data["__schema"]["types"]}
        expected = {"BookNode", "AuthorNode", "Query", "Mutation"}
        self.assertTrue(expected.issubset(type_names))

    def test_deprecated_fields_documented(self):
        """All deprecated fields must have a deprecation reason."""
        from myapp.schema import schema
        result = schema.execute("""
            {
                __schema {
                    types {
                        name
                        fields(includeDeprecated: true) {
                            name
                            isDeprecated
                            deprecationReason
                        }
                    }
                }
            }
        """)
        for type_info in result.data["__schema"]["types"]:
            if type_info["fields"]:
                for field in type_info["fields"]:
                    if field["isDeprecated"]:
                        self.assertIsNotNone(
                            field["deprecationReason"],
                            f"{type_info['name']}.{field['name']} is deprecated without a reason",
                        )
```

## Fixtures and Factories

### Using factory_boy

```python
import factory
from myapp.models import Author, Book

class AuthorFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Author

    name = factory.Sequence(lambda n: f"Author {n}")
    bio = factory.Faker("paragraph")

class BookFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Book

    title = factory.Sequence(lambda n: f"Book {n}")
    author = factory.SubFactory(AuthorFactory)
    status = "published"
    isbn = factory.Faker("isbn13")

# In tests
class BookQueryTest(GraphQLTestCase):
    def test_book_list(self):
        BookFactory.create_batch(5)
        response = self.query("{ allBooks { edges { node { title } } } }")
        self.assertEqual(len(response["data"]["allBooks"]["edges"]), 5)

    def test_books_by_author(self):
        author = AuthorFactory()
        BookFactory.create_batch(3, author=author)
        BookFactory.create_batch(2)  # different authors

        response = self.query("""
            query ($name: String!) {
                allBooks(author_Name: $name) {
                    edges { node { title } }
                }
            }
        """, variables={"name": author.name})
        self.assertEqual(len(response["data"]["allBooks"]["edges"]), 3)
```

## Testing Best Practices

| Practice | Rationale |
| --- | --- |
| Use `assertNumQueries` for every list query test | Catches N+1 regressions before they hit production |
| Test both authenticated and anonymous access | Authorization bugs are security bugs |
| Test pagination boundaries (first page, last page, empty) | Edge cases in cursor pagination cause silent data loss |
| Test mutation idempotency where applicable | Network retries can cause duplicate creates |
| Use `schema.execute()` for unit tests, HTTP client for integration | Schema tests are faster, HTTP tests catch middleware issues |
| Test error responses, not just happy paths | Error format consistency matters for clients |
| Avoid testing GraphQL framework internals | Test your resolvers and business logic, not graphene itself |
