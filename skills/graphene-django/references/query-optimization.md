---
title: Query Optimization
description: Relay pagination, query complexity and depth limiting, subquery patterns in resolvers
tags: graphene-django, optimization, relay, pagination, complexity, depth, subquery
---

# Query Optimization

## Relay Pagination

### Why Relay Cursor Pagination

Offset-based pagination (`LIMIT/OFFSET`) degrades on large datasets — the database still scans skipped rows. Relay's cursor-based pagination uses opaque cursors (typically base64-encoded PKs) for stable, performant paging.

### DjangoFilterConnectionField

```python
import graphene
from graphene_django import DjangoObjectType
from graphene_django.filter import DjangoFilterConnectionField

class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)
        filter_fields = {
            "title": ["exact", "icontains"],
            "author__name": ["exact", "icontains"],
            "published_date": ["exact", "gte", "lte"],
        }

class Query(graphene.ObjectType):
    all_books = DjangoFilterConnectionField(BookNode)
```

```graphql
# Client query — first 10 books, then paginate forward
{
  allBooks(first: 10) {
    edges {
      cursor
      node {
        title
        author { name }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

# Next page
{
  allBooks(first: 10, after: "YXJyYXljb25uZWN0aW9uOjk=") {
    edges { node { title } }
    pageInfo { hasNextPage endCursor }
  }
}
```

### Optimizing ConnectionField Querysets

Override `get_queryset` on the Node type — not the resolver — to apply base filters and optimizations:

```python
class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)

    @classmethod
    def get_queryset(cls, queryset, info):
        # Apply base optimization — this runs before pagination
        return queryset.select_related("author").only(
            "id", "title", "published_date", "author__name"
        )
```

### Efficient Total Count

Relay connections include `totalCount` by default via `COUNT(*)`. For large tables, this is expensive.

```python
class BookConnection(graphene.relay.Connection):
    class Meta:
        node = BookNode

    total_count = graphene.Int()

    def resolve_total_count(root, info):
        # Use a cached/approximate count for large tables
        # Option 1: Exact (default, expensive)
        return root.length

        # Option 2: Approximate (fast, for tables > 100k rows)
        # from django.db import connection
        # with connection.cursor() as cursor:
        #     cursor.execute(
        #         "SELECT reltuples::bigint FROM pg_class WHERE relname = %s",
        #         [Book._meta.db_table],
        #     )
        #     return cursor.fetchone()[0]
```

### Pagination Anti-Patterns

```python
# BAD: Fetching all objects then slicing in Python
def resolve_all_books(self, info):
    return list(Book.objects.all())[:10]  # loads entire table into memory

# BAD: Using offset pagination on large tables
def resolve_all_books(self, info, page=1, page_size=10):
    offset = (page - 1) * page_size
    return Book.objects.all()[offset:offset + page_size]  # slow at high offsets

# GOOD: Use DjangoFilterConnectionField with Relay cursor pagination
all_books = DjangoFilterConnectionField(BookNode)
```

## Query Complexity and Depth Limiting

### Depth Limiting

Prevents deeply nested queries that cause exponential resolver calls.

```python
from graphql import parse
from graphql.language.visitor import Visitor, visit

class DepthLimitValidator(Visitor):
    def __init__(self, max_depth):
        super().__init__()
        self.max_depth = max_depth
        self.current_depth = 0

    def enter_field(self, node, *args):
        self.current_depth += 1
        if self.current_depth > self.max_depth:
            raise Exception(
                f"Query depth {self.current_depth} exceeds maximum {self.max_depth}"
            )

    def leave_field(self, node, *args):
        self.current_depth -= 1

# Using graphene's validation_rules
GRAPHENE = {
    "SCHEMA": "myapp.schema.schema",
    "MIDDLEWARE": ["myapp.middleware.DataLoaderMiddleware"],
}

# Apply in view
from graphene_django.views import GraphQLView

class RateLimitedGraphQLView(GraphQLView):
    def execute_graphql_request(self, request, data, query, *args, **kwargs):
        # Validate depth before execution
        if query:
            document = parse(query)
            depth_checker = DepthLimitValidator(max_depth=10)
            visit(document, depth_checker)
        return super().execute_graphql_request(request, data, query, *args, **kwargs)
```

### Using graphql-core Validation Rules

```python
from graphql import validate, parse
from graphql.validation import ASTValidationRule
from graphql.language import FieldNode

class DepthLimitRule(ASTValidationRule):
    def __init__(self, context):
        super().__init__(context)
        self.max_depth = 10
        self.operation_depth = 0

    def enter_field(self, node: FieldNode, *_args):
        self.operation_depth += 1
        if self.operation_depth > self.max_depth:
            self.report_error(
                GraphQLError(f"Query exceeds maximum depth of {self.max_depth}")
            )

    def leave_field(self, node: FieldNode, *_args):
        self.operation_depth -= 1

# Register in schema
schema = graphene.Schema(query=Query, mutation=Mutation)
```

### Query Complexity Analysis

Assign cost to each field; reject queries exceeding a budget.

```python
# Define cost per field
FIELD_COSTS = {
    "allBooks": 1,
    "books": 2,       # nested relation
    "reviews": 3,     # expensive relation
    "analytics": 10,  # very expensive
}

class ComplexityAnalyzer:
    def __init__(self, max_complexity=100):
        self.max_complexity = max_complexity

    def estimate(self, document, variables=None):
        """Walk the AST and sum field costs, multiplied by pagination args."""
        total = self._visit_selections(
            document.definitions[0].selection_set.selections,
            multiplier=1,
        )
        if total > self.max_complexity:
            raise Exception(
                f"Query complexity {total} exceeds maximum {self.max_complexity}"
            )
        return total

    def _visit_selections(self, selections, multiplier):
        total = 0
        for field in selections:
            if not hasattr(field, "name"):
                continue
            name = field.name.value
            cost = FIELD_COSTS.get(name, 1) * multiplier

            # Multiply by first/last arg for paginated fields
            child_multiplier = multiplier
            if field.arguments:
                for arg in field.arguments:
                    if arg.name.value in ("first", "last"):
                        child_multiplier = int(arg.value.value) * multiplier

            total += cost
            if field.selection_set:
                total += self._visit_selections(
                    field.selection_set.selections, child_multiplier
                )
        return total
```

## Subquery Patterns in Resolvers

### Never Materialize Querysets into Lists for `__in`

```python
# BAD: Materializes the entire queryset into Python, then sends IDs back to DB
def resolve_active_books(self, info):
    active_author_ids = list(
        Author.objects.filter(is_active=True).values_list("id", flat=True)
    )
    return Book.objects.filter(author_id__in=active_author_ids)

# GOOD: Let Django generate a subquery — single SQL roundtrip
def resolve_active_books(self, info):
    active_authors = Author.objects.filter(is_active=True).values("id")
    return Book.objects.filter(author_id__in=active_authors)

# Generated SQL:
# SELECT * FROM book WHERE author_id IN (SELECT id FROM author WHERE is_active = true)
```

### Subquery Annotations

```python
from django.db.models import Subquery, OuterRef, Count

# Annotate each author with their latest book's title
latest_book = (
    Book.objects.filter(author=OuterRef("pk"))
    .order_by("-published_date")
    .values("title")[:1]
)

def resolve_all_authors(self, info):
    return Author.objects.annotate(
        latest_book_title=Subquery(latest_book)
    )
```

### Exists Subqueries

```python
from django.db.models import Exists, OuterRef

# Filter authors who have at least one published book
published_books = Book.objects.filter(
    author=OuterRef("pk"), status="published"
)

def resolve_published_authors(self, info):
    return Author.objects.filter(Exists(published_books))

# Generated SQL:
# SELECT * FROM author WHERE EXISTS (
#     SELECT 1 FROM book WHERE book.author_id = author.id AND book.status = 'published'
# )
```

### F-Expressions in Resolvers

```python
from django.db.models import F

# Don't fetch to Python for comparisons
def resolve_understocked_products(self, info):
    return Product.objects.filter(stock__lt=F("reorder_level"))
```

## Query Logging and Profiling

### EXPLAIN in Resolvers (Debug Only)

```python
def resolve_all_books(self, info):
    qs = Book.objects.select_related("author").filter(status="published")
    if settings.DEBUG:
        print(qs.explain(analyze=True))
    return qs
```

### Middleware-Based Query Counting

```python
import time
from django.db import connection, reset_queries
from django.conf import settings

class QueryCountMiddleware:
    def resolve(self, next, root, info, **args):
        if not settings.DEBUG:
            return next(root, info, **args)

        start_queries = len(connection.queries)
        start_time = time.time()
        result = next(root, info, **args)
        end_time = time.time()
        query_count = len(connection.queries) - start_queries

        if query_count > 5:
            print(
                f"[WARN] {info.parent_type.name}.{info.field_name}: "
                f"{query_count} queries in {end_time - start_time:.3f}s"
            )
        return result
```
