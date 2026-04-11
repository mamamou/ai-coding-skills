---
title: Security Best Practices
description: Depth limiting, introspection control, query cost analysis, and authentication/authorization in resolvers
tags: graphene-django, security, depth-limiting, introspection, auth, authorization, query-cost
---

# Security Best Practices

## Disable Introspection in Production

Introspection exposes your entire schema — types, fields, arguments, deprecations. Disable it in production.

### Method 1: graphene Setting

```python
# settings.py
GRAPHENE = {
    "SCHEMA": "myapp.schema.schema",
    "MIDDLEWARE": ["myapp.middleware.AuthMiddleware"],
}

# In your view — disable introspection for non-staff
from graphene_django.views import GraphQLView

class SecureGraphQLView(GraphQLView):
    def execute_graphql_request(self, request, data, query, *args, **kwargs):
        # Block introspection queries in production
        if query and "__schema" in query and not request.user.is_staff:
            from graphql import GraphQLError
            raise GraphQLError("Introspection is disabled.")
        return super().execute_graphql_request(request, data, query, *args, **kwargs)
```

### Method 2: Validation Rule

```python
from graphql import GraphQLError
from graphql.validation import ASTValidationRule
from graphql.language import FieldNode

class DisableIntrospection(ASTValidationRule):
    def enter_field(self, node: FieldNode, *_args):
        if node.name.value in ("__schema", "__type"):
            self.report_error(
                GraphQLError("Introspection is disabled.", node)
            )

# Apply to schema execution
from graphql import validate

errors = validate(
    schema.graphql_schema,
    document,
    rules=[DisableIntrospection],
)
```

### Introspection Rules

- **Development:** Enable introspection for tooling (GraphiQL, Apollo Studio)
- **Staging:** Enable for QA, disable for external access
- **Production:** Always disable for public-facing endpoints; optionally enable for authenticated internal tools behind VPN/auth
- Introspection alone is not security — it's obscurity. Always enforce proper authorization regardless.

## Query Depth Limiting

Prevents resource exhaustion from deeply nested queries:

```graphql
# Malicious query — exponential resolver calls
{
  authors {
    books {
      author {
        books {
          author {
            books { title }
          }
        }
      }
    }
  }
}
```

### Implementation

```python
from graphql.language import FieldNode, FragmentSpreadNode, InlineFragmentNode

def get_query_depth(node, fragments, depth=0):
    """Recursively calculate maximum query depth."""
    if not hasattr(node, "selection_set") or not node.selection_set:
        return depth

    max_depth = depth
    for selection in node.selection_set.selections:
        if isinstance(selection, FieldNode):
            field_depth = get_query_depth(selection, fragments, depth + 1)
            max_depth = max(max_depth, field_depth)
        elif isinstance(selection, FragmentSpreadNode):
            fragment = fragments.get(selection.name.value)
            if fragment:
                field_depth = get_query_depth(fragment, fragments, depth)
                max_depth = max(max_depth, field_depth)
        elif isinstance(selection, InlineFragmentNode):
            field_depth = get_query_depth(selection, fragments, depth)
            max_depth = max(max_depth, field_depth)

    return max_depth


class DepthLimitMiddleware:
    MAX_DEPTH = 10

    def resolve(self, next, root, info, **args):
        # Only check at the root level
        if info.path and len(info.path) == 1:
            document = info.operation
            fragments = {
                name: node
                for name, node in (info.fragments or {}).items()
            }
            depth = get_query_depth(document, fragments)
            if depth > self.MAX_DEPTH:
                raise Exception(
                    f"Query depth {depth} exceeds maximum allowed depth of {self.MAX_DEPTH}"
                )
        return next(root, info, **args)
```

### Recommended Depth Limits

| API Type | Max Depth | Rationale |
| --- | --- | --- |
| Public API | 5-7 | Untrusted clients, limit attack surface |
| Authenticated API | 8-10 | Known users, moderate nesting |
| Internal API | 12-15 | Trusted services, complex queries needed |
| Admin/Debug | Unlimited | Staff only, behind VPN |

## Query Cost Analysis

Assign costs to fields and reject expensive queries before execution.

```python
FIELD_COSTS = {
    # List fields — cost multiplied by pagination argument
    "allBooks": 1,
    "allAuthors": 1,
    # Relations
    "books": 2,
    "reviews": 3,
    # Expensive computed fields
    "analytics": 10,
    "fullTextSearch": 5,
}

MAX_QUERY_COST = 100  # Adjust per API tier

class QueryCostMiddleware:
    def resolve(self, next, root, info, **args):
        # Calculate cost at top-level only
        if root is None:
            cost = self._calculate_cost(info)
            if cost > MAX_QUERY_COST:
                raise Exception(
                    f"Query cost {cost} exceeds maximum {MAX_QUERY_COST}. "
                    f"Reduce pagination size or requested fields."
                )
        return next(root, info, **args)

    def _calculate_cost(self, info):
        # Walk the AST and sum costs
        total = 0
        for field in info.field_nodes:
            total += self._field_cost(field, multiplier=1)
        return total

    def _field_cost(self, field, multiplier):
        name = field.name.value
        base_cost = FIELD_COSTS.get(name, 1)

        # Multiply by first/last for paginated fields
        child_multiplier = multiplier
        if field.arguments:
            for arg in field.arguments:
                if arg.name.value in ("first", "last"):
                    try:
                        child_multiplier = int(arg.value.value)
                    except (ValueError, AttributeError):
                        child_multiplier = 10  # default assumption

        cost = base_cost * multiplier
        if field.selection_set:
            for sub in field.selection_set.selections:
                if hasattr(sub, "name"):
                    cost += self._field_cost(sub, child_multiplier)
        return cost
```

## Authentication in Resolvers

### Middleware-Based Auth

```python
class AuthenticationMiddleware:
    def resolve(self, next, root, info, **args):
        # Skip auth for introspection and public fields
        if info.field_name.startswith("__"):
            return next(root, info, **args)

        # Require authentication for all queries
        if not info.context.user.is_authenticated:
            raise Exception("Authentication required.")

        return next(root, info, **args)
```

### Per-Resolver Authorization

```python
from functools import wraps

def login_required(func):
    @wraps(func)
    def wrapper(cls_or_self, info, *args, **kwargs):
        if not info.context.user.is_authenticated:
            raise Exception("Authentication required.")
        return func(cls_or_self, info, *args, **kwargs)
    return wrapper

def permission_required(*perms):
    def decorator(func):
        @wraps(func)
        def wrapper(cls_or_self, info, *args, **kwargs):
            user = info.context.user
            if not user.has_perms(perms):
                raise Exception(f"Missing permissions: {', '.join(perms)}")
            return func(cls_or_self, info, *args, **kwargs)
        return wrapper
    return decorator

def staff_required(func):
    @wraps(func)
    def wrapper(cls_or_self, info, *args, **kwargs):
        if not info.context.user.is_staff:
            raise Exception("Staff access required.")
        return func(cls_or_self, info, *args, **kwargs)
    return wrapper

# Usage
class Query(graphene.ObjectType):
    all_users = graphene.List(UserType)
    admin_dashboard = graphene.Field(DashboardType)

    @login_required
    def resolve_all_users(self, info):
        return User.objects.all()

    @staff_required
    def resolve_admin_dashboard(self, info):
        return Dashboard.load()
```

### Object-Level Authorization

```python
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "author", "status", "internal_notes")

    def resolve_internal_notes(self, info):
        """Only staff can see internal notes."""
        if not info.context.user.is_staff:
            return None
        return self.internal_notes

    @classmethod
    def get_queryset(cls, queryset, info):
        """Row-level filtering — non-staff only see published books."""
        if not info.context.user.is_staff:
            return queryset.filter(status="published")
        return queryset
```

### Mutation Authorization

```python
class DeleteBook(graphene.Mutation):
    class Arguments:
        id = graphene.Int(required=True)

    ok = graphene.Boolean()

    @classmethod
    @permission_required("books.delete_book")
    def mutate(cls, root, info, id):
        try:
            book = Book.objects.get(pk=id)
        except Book.DoesNotExist:
            raise Exception("Book not found.")

        # Object-level check — user must own the book or be staff
        if book.author.user != info.context.user and not info.context.user.is_staff:
            raise Exception("You can only delete your own books.")

        book.delete()
        return DeleteBook(ok=True)
```

## Rate Limiting

### Per-User Query Rate Limiting

```python
from django.core.cache import cache
from django.conf import settings

class RateLimitMiddleware:
    # Requests per minute per user
    RATE_LIMIT = getattr(settings, "GRAPHQL_RATE_LIMIT", 60)
    WINDOW = 60  # seconds

    def resolve(self, next, root, info, **args):
        # Only rate limit at the operation level
        if root is not None:
            return next(root, info, **args)

        user = info.context.user
        if user.is_authenticated:
            key = f"graphql_rate:{user.id}"
        else:
            ip = info.context.META.get("REMOTE_ADDR", "unknown")
            key = f"graphql_rate:anon:{ip}"

        count = cache.get(key, 0)
        if count >= self.RATE_LIMIT:
            raise Exception("Rate limit exceeded. Try again later.")

        cache.set(key, count + 1, self.WINDOW)
        return next(root, info, **args)
```

## Security Checklist

| Control | Environment | Priority |
| --- | --- | --- |
| Disable introspection | Production | **Critical** |
| Depth limiting (≤10) | All | **Critical** |
| Query cost analysis | Production | High |
| Authentication middleware | All authenticated APIs | **Critical** |
| Object-level authorization | All | High |
| Rate limiting | Production | High |
| Input validation (max string lengths, enum validation) | All | High |
| Error message sanitization (don't leak stack traces) | Production | **Critical** |
| CORS configuration | Production | High |
| CSRF protection for cookie-based auth | Production | **Critical** |
| Request size limiting (max query length) | Production | Medium |
| Persisted queries (reject arbitrary queries) | Production (public APIs) | Medium |
