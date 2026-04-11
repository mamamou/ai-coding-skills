---
title: Testing
description: strawberry_django.test.client.TestClient for GraphQL tests, authenticated sessions with client.login(), asserting optimizer query counts, async testing, and schema snapshot tests
tags: strawberry-django, testing, TestClient, pytest, assertNumQueries, async, snapshot
---

# Testing

Strawberry-django ships a `TestClient` that wraps Django's test client to send GraphQL operations and deserialize the results. It integrates with Django's test database fixtures (`@pytest.mark.django_db`, or the `db` pytest-django fixture) and supports authenticated sessions via `client.login(user)`. This page covers the happy-path patterns plus three things every team eventually regrets skipping: query-count regression tests, async test setup, and schema snapshots.

## The Test Client

```python
from strawberry_django.test.client import TestClient

def test_me_unauthenticated(db):
    client = TestClient("/graphql")
    res = client.query("""
        query {
          me { id email }
        }
    """)
    assert res.errors is None
    assert res.data == {"me": None}


def test_me_authenticated(db, django_user_model):
    user = django_user_model.objects.create(email="a@b.co")
    client = TestClient("/graphql")

    with client.login(user):
        res = client.query("""
            query {
              me { id email }
            }
        """)

    assert res.errors is None
    assert res.data["me"]["email"] == "a@b.co"
```

The client lives inside Django's testing machinery, so `db` transactions roll back between tests, and you get a fresh database per test function. `client.login(user)` is a context manager — anything inside it runs as `user`; anything outside runs unauthenticated.

### Variables and Operation Name

```python
res = client.query(
    """
    query GetBook($id: ID!) {
      book(id: $id) { title author { name } }
    }
    """,
    variables={"id": book.pk},
    operation_name="GetBook",
)
```

Always pass variables, never format them into the query string. Interpolating into the query is not only a test smell (it hides what is actually sent) but will also bypass variable coercion — you might pass a test that would fail in production.

## Asserting Query Counts (Lock Down the Optimizer)

The strongest signal that a new resolver has escaped the optimizer is a jump in query count. Lock it down:

```python
from django.test import TestCase
from strawberry_django.test.client import TestClient

class BookQueryTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        for i in range(50):
            author = Author.objects.create(name=f"Author {i}")
            for j in range(3):
                Book.objects.create(title=f"Book {i}-{j}", author=author)

    def test_books_no_n_plus_one(self):
        client = TestClient("/graphql")
        query = """
            { books { title author { name } } }
        """
        with self.assertNumQueries(2):  # 1 for books, 1 for authors via prefetch
            res = client.query(query)
        assert res.errors is None
```

A few discipline points that keep these tests useful:

- **Seed enough data to expose a problem.** If `setUpTestData` creates two books, you will not see an N+1 — it will look like a normal nested query. Twenty rows is the minimum for a meaningful test.
- **Assert an exact count, not `<= n`.** "No more than 10 queries" silently accepts regressions. If the expected count changes, you want the test to fail and force a conscious update.
- **Test each field selection you care about.** If `author` and `reviews` are separate optimizer paths, test both — one of them might regress without touching the other.

`self.assertNumQueries` wraps the whole block in a query collector. Under the async view, wrap the test method in `async def` and use `await sync_to_async(...)` around the client call, since `assertNumQueries` is sync.

## Testing Mutations

Mutations are tested the same way — send the mutation string and assert on the result union:

```python
def test_create_fruit_validation(db):
    client = TestClient("/graphql")
    res = client.query("""
        mutation {
          createFruit(name: "", color: "ruby") {
            __typename
            ... on Fruit { id name }
            ... on OperationInfo {
              messages { kind field message code }
            }
          }
        }
    """)
    assert res.errors is None
    payload = res.data["createFruit"]
    assert payload["__typename"] == "OperationInfo"
    assert payload["messages"][0]["field"] == "name"
    assert payload["messages"][0]["kind"] == "VALIDATION"
```

Two things worth noting:

- **Test both the happy and error paths.** With the `OperationInfo` union, there are two shapes the client will actually receive — if you only test one, a regression will not be caught until production.
- **Pin error codes, not messages.** If your assertion reads `"code": "DUPLICATE_EMAIL"`, translations and wording changes do not break the test. Asserting on the English `message` makes the test brittle.

## Async Tests

Under `AsyncGraphQLView`, use pytest-django's async support:

```python
import pytest

@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_live_count():
    from strawberry_django.test.client import AsyncTestClient
    client = AsyncTestClient("/graphql")

    res = await client.query("query { me { id } }")
    assert res.errors is None
```

`transaction=True` is required because async views use real connections across thread boundaries, and the default wrap-in-transaction fixture breaks. Expect slower tests in exchange.

For subscription tests, test the async generator directly rather than through the WebSocket transport:

```python
@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_count_subscription():
    from .schema import Subscription
    gen = Subscription.count(target=3)
    values = [v async for v in gen]
    assert values == [0, 1, 2]
```

End-to-end WebSocket tests are valuable for the router wiring, but one or two smoke tests are enough — cover the actual business logic at the generator level where it is fast and deterministic.

## Testing Permissions

Three cases matter:

1. Anonymous user cannot see gated fields.
2. Authenticated user without permission gets a permission error.
3. Authenticated user with permission sees the field.

```python
def test_draft_books_requires_perm(db, django_user_model):
    user = django_user_model.objects.create(email="a@b.co")
    client = TestClient("/graphql")

    with client.login(user):
        res = client.query("query { draftBooks { id } }")
    assert res.errors is not None
    assert res.errors[0]["extensions"]["code"] == "PERMISSION_DENIED"

    user.user_permissions.add(
        Permission.objects.get(codename="view_draft_book")
    )
    with client.login(user):
        res = client.query("query { draftBooks { id } }")
    assert res.errors is None
```

For permissions that depend on django-guardian, grant the object permission inside the test with `guardian.shortcuts.assign_perm(...)` and verify that filter and detail-page permissions return the expected subset.

## Schema Snapshot Tests

A snapshot of the printed schema is the cheapest way to catch unintentional API changes. It takes about three lines:

```python
from pathlib import Path
from .schema import schema

SNAPSHOT = Path(__file__).parent / "schema.graphql"

def test_schema_snapshot():
    current = str(schema)
    expected = SNAPSHOT.read_text()
    assert current == expected, (
        "Schema changed. If this is intentional, update schema.graphql."
    )
```

Check `schema.graphql` into git. Any PR that changes the schema will make the test fail, forcing the author to either update the snapshot (and get a human review on the diff) or revert the accidental change. This has caught more "oops I added a field" bugs than every other test type combined.

## Fixtures for Seed Data

Keep fixtures in pytest fixtures or `setUpTestData`, not hardcoded in each test:

```python
@pytest.fixture
def author_with_books(db):
    author = Author.objects.create(name="Ada")
    for i in range(3):
        Book.objects.create(author=author, title=f"Book {i}")
    return author
```

Do **not** use JSON fixtures loaded with `call_command("loaddata", ...)` — they are slow, hide the actual data shape from the test, and break on model changes. Build test data with ORM calls (or model factories via `factory_boy`) and keep them close to the tests that use them.

## Running the Test Suite

Under pytest:

```bash
pytest -x --reuse-db
```

`--reuse-db` drastically speeds up iteration; combine with `--create-db` whenever you change migrations. In CI, drop `--reuse-db` so the DB is always pristine.

For async suites, ensure pytest-asyncio and pytest-django are both installed and that `asyncio_mode = auto` is set in `pyproject.toml` so you do not have to decorate every async test.
