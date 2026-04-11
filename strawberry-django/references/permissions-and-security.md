---
title: Permissions and Security
description: Strawberry-django permission extensions (IsAuthenticated, IsStaff, HasPerm, HasRetvalPerm, HasSourcePerm), django-guardian object-level perms, DisableIntrospection, QueryDepthLimiter, MaxTokensLimiter, MaxAliasesLimiter, error masking
tags: strawberry-django, permissions, security, IsAuthenticated, HasPerm, HasRetvalPerm, django-guardian, introspection, depth, tokens, aliases
---

# Permissions and Security

Strawberry hardens a GraphQL API through two layers:

1. **Field extensions** for authorization — permission classes attached to individual fields or applied broadly via type defaults.
2. **Schema extensions** for DoS protection — depth, tokens, aliases, and introspection limits applied globally.

Together, these replace Graphene's middleware-based approach with a declarative, per-field model. Nothing is implicit — if a field has no permission extension, it is public.

## Built-in Permission Extensions

Strawberry-django ships a set of permission extensions in `strawberry_django.permissions`:

| Extension         | Checks                                                         | Best for                                    |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `IsAuthenticated` | `user.is_authenticated and user.is_active`                     | Gating any field behind login               |
| `IsStaff`         | `user.is_staff`                                                | Admin-only fields                           |
| `IsSuperuser`     | `user.is_superuser`                                            | Root-only fields (rarely used in production)|
| `HasPerm`         | Model-level `user.has_perm(app.codename)`                      | Global CRUD gates                           |
| `HasSourcePerm`   | Permission check against the **parent** object                 | "Can see this book's internal notes"        |
| `HasRetvalPerm`   | Permission check against the **returned** object(s); lists are auto-filtered | Row-level visibility on collections |

They attach to fields as `extensions=[...]`:

```python
from strawberry_django.permissions import (
    IsAuthenticated,
    HasPerm,
    HasRetvalPerm,
)

@strawberry.type
class Query:
    @strawberry_django.field(extensions=[IsAuthenticated()])
    def me(self, info: strawberry.Info) -> UserType | None:
        return info.context["request"].user

    @strawberry_django.field(extensions=[HasPerm("books.view_draft_book")])
    def draft_books(self) -> list[BookType]:
        return Book.objects.filter(status="draft")

    @strawberry_django.field(extensions=[HasRetvalPerm("books.view_book")])
    def books(self) -> list[BookType]:
        return Book.objects.all()
```

### `HasRetvalPerm` vs `get_queryset`

`HasRetvalPerm` applied to a list filters the returned queryset, keeping only rows the user has permission to see. That sounds similar to `get_queryset` on the type, but the two serve different purposes:

- **`get_queryset`**: visibility rule, expressed as a filter on the SQL level. Cheap, composable with `select_related`/`prefetch_related`, works inside the optimizer, **cannot leverage object-level permissions** (django-guardian).
- **`HasRetvalPerm`**: authorization check, applied post-query, supports object-level permissions. More expensive because it has to check each row, but required when permissions are per-object (guardian `view_book` granted on a specific `Book` instance).

Use `get_queryset` when you can express the rule as a filter. Fall back to `HasRetvalPerm` only for genuine per-object ACLs.

## Object-Level Permissions With `django-guardian`

Strawberry-django integrates with `django-guardian` out of the box. Install it, add it to `INSTALLED_APPS`, and `HasPerm`/`HasRetvalPerm`/`HasSourcePerm` will honour guardian-assigned per-object permissions without additional configuration.

```python
INSTALLED_APPS = [
    # ...
    "guardian",
]

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "guardian.backends.ObjectPermissionBackend",
]
```

Then guardian-protected fields work declaratively:

```python
@strawberry_django.type(Document)
class DocumentType:
    id: auto
    title: auto

    @strawberry_django.field(extensions=[HasSourcePerm("documents.view_document")])
    def body(self) -> str:
        return self.body  # only visible if user has view_document on THIS document
```

If you cannot use guardian (e.g. you have your own ACL table), subclass `DjangoPermissionExtension` and implement `resolve_for_user` — you inherit the same declarative attach-to-field ergonomics.

## Fine-Grained Permission Classes

For logic that does not fit the built-ins, write a plain `BasePermission`:

```python
import typing
import strawberry
from strawberry.permission import BasePermission

class OwnsOrganization(BasePermission):
    message = "You are not the owner of this organization."
    error_extensions = {"code": "NOT_ORG_OWNER"}  # surfaced in the GraphQL error

    async def has_permission(
        self, source: typing.Any, info: strawberry.Info, **kwargs
    ) -> bool:
        user = info.context["request"].user
        org_id = kwargs.get("organization_id")
        return await Organization.objects.filter(
            id=org_id, owner=user,
        ).aexists()

@strawberry.type
class Mutation:
    @strawberry.mutation(permission_classes=[OwnsOrganization])
    async def rename_org(self, organization_id: strawberry.ID, name: str) -> OrgType:
        ...
```

`has_permission` can be async, which matters for real-world ACL checks that hit the database. Returning `False` produces a `GraphQLError` with the configured `message` and `error_extensions` — clients can discriminate on the `code`.

### Keep Permission Messages Generic

Do not leak information in the failure message. `"You do not own organization 42"` tells an attacker that organization 42 exists. Prefer `"Not authorized"` and rely on `error_extensions.code` for client logic.

## Disable Introspection in Production

Introspection exposes your entire schema — types, fields, descriptions, arguments. Disable it on production unless the endpoint is gated behind an authenticated internal tool.

```python
import strawberry
from strawberry.extensions import DisableIntrospection

schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    extensions=[
        DisableIntrospection(),
        # ... other extensions
    ],
)
```

For staged environments, toggle via settings:

```python
import strawberry
from django.conf import settings
from strawberry.extensions import DisableIntrospection
from strawberry_django.optimizer import DjangoOptimizerExtension

extensions = [DjangoOptimizerExtension]
if not settings.DEBUG:
    extensions.append(DisableIntrospection())

schema = strawberry.Schema(query=Query, extensions=extensions)
```

Introspection alone is not security — it is obscurity. Treat it as one small reduction in attack-surface, not a substitute for real authorization.

## DoS Protection: Depth, Tokens, Aliases

A malicious client can exhaust your server with three cheap tricks: deep nesting, huge payloads, and alias explosion. Strawberry ships extensions for each.

### `QueryDepthLimiter`

```python
from strawberry.extensions import QueryDepthLimiter

schema = strawberry.Schema(
    query=Query,
    extensions=[QueryDepthLimiter(max_depth=10)],
)
```

A nested query like `{ authors { books { author { books { ... } } } } }` is rejected before execution. Pick a value based on your schema: 7–10 is a sensible default; raise it only if you have legitimate deep-nesting use cases and you have profiled them.

### `MaxTokensLimiter`

```python
from strawberry.extensions import MaxTokensLimiter

schema = strawberry.Schema(
    query=Query,
    extensions=[MaxTokensLimiter(max_token_count=1500)],
)
```

Limits the raw token count in the parsed query document. This blocks the "submit a 10 MB query" class of attacks regardless of nesting depth.

### `MaxAliasesLimiter`

```python
from strawberry.extensions import MaxAliasesLimiter

schema = strawberry.Schema(
    query=Query,
    extensions=[MaxAliasesLimiter(max_alias_count=15)],
)
```

This is the one people forget. An attacker can bypass depth limits by aliasing the same expensive field hundreds of times in a single query — each alias executes the resolver independently. `MaxAliasesLimiter` is cheap and should be on every production schema.

A baseline production schema therefore looks like:

```python
from strawberry.extensions import (
    DisableIntrospection,
    MaxAliasesLimiter,
    MaxTokensLimiter,
    QueryDepthLimiter,
)
from strawberry_django.optimizer import DjangoOptimizerExtension

schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    extensions=[
        DjangoOptimizerExtension,
        QueryDepthLimiter(max_depth=10),
        MaxTokensLimiter(max_token_count=1500),
        MaxAliasesLimiter(max_alias_count=15),
        DisableIntrospection(),
    ],
)
```

## Error Masking — Do Not Leak Tracebacks

By default, strawberry surfaces exception messages in the response. For production, install a handler that logs the full traceback server-side and returns a generic message to clients:

```python
# settings.py
import strawberry

def mask_errors(error, debug: bool):
    # Log server-side with structured context
    logger.exception("GraphQL error", extra={"path": error.path})
    if debug:
        return error
    return strawberry.exceptions.StrawberryGraphQLError(
        message="Internal server error",
        original_error=None,
    )
```

Never send Python class names, SQL snippets, or file paths to clients. Error extensions are fine for discriminators (`code="NOT_FOUND"`), but the `message` should be user-friendly and free of internals.

## Rate Limiting

Strawberry does not ship a rate limiter — that is a transport-level concern. Apply rate limiting **before** the request reaches the GraphQL view, at the reverse proxy (Nginx `limit_req`, Cloudflare) or at Django middleware level (`django-ratelimit`). If your view is `AsyncGraphQLView`, use an async-compatible middleware.

A GraphQL-specific middleware can be useful if you want to rate-limit by operation name or cost, but make sure it does not double-count against a global limiter upstream.

## Authentication Wiring

Strawberry does not authenticate — Django does. Plug Django's authentication middleware in the normal way and read the user from `info.context["request"].user`:

```python
from strawberry_django.auth.utils import get_current_user

def resolver(root, info: strawberry.Info):
    user = get_current_user(info)
    ...
```

For JWT/token auth, add a DRF or custom authentication backend to Django's middleware stack; the user will be populated before the GraphQL view runs. For session auth, the built-in `strawberry_django.auth.login/logout/current_user` mutations wrap Django's session login and are enough for server-rendered apps.

## Security Checklist

| Control                                | Dev  | Staging | Prod |
| -------------------------------------- | ---- | ------- | ---- |
| `DjangoOptimizerExtension` enabled     | ✓    | ✓       | ✓    |
| `QueryDepthLimiter` (≤10)              | ✓    | ✓       | ✓    |
| `MaxTokensLimiter`                     | —    | ✓       | ✓    |
| `MaxAliasesLimiter`                    | —    | ✓       | ✓    |
| `DisableIntrospection`                 | —    | optional | ✓    |
| Error masking / no raw tracebacks      | —    | ✓       | ✓    |
| `get_queryset` or `HasRetvalPerm` on sensitive types | ✓ | ✓ | ✓ |
| Permission classes on all mutations    | ✓    | ✓       | ✓    |
| Rate limiting (at proxy level)         | —    | ✓       | ✓    |
| CSRF for cookie-based auth             | ✓    | ✓       | ✓    |
| CORS restricted to known origins       | —    | ✓       | ✓    |
