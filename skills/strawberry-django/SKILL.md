---
name: strawberry-django
description: Strawberry-Django best practices — DjangoOptimizerExtension, DataLoader, type-hint-first schemas, CRUD mutations, filters/pagination/Relay, permission extensions, security hardening, async/subscriptions, and testing. Load when working with strawberry-graphql-django.
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Strawberry-Django

Strawberry-Django takes a very different shape from Graphene: it is type-hint-first, uses schema **extensions** (not middleware), ships a built-in query optimizer, generates CRUD mutations/filters/pagination from Django models, and is async-native. The references below focus on what is specific to Strawberry, not general GraphQL.

## Query Optimization

| Topic                       | Reference                                                                | Use for                                                                        |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| DjangoOptimizerExtension    | [references/optimizer.md](references/optimizer.md)                       | Automatic `only`/`select_related`/`prefetch_related`/`annotate` from AST, hint fields, custom resolver optimization, edge cases |
| N+1 and DataLoaders         | [references/n-plus-one.md](references/n-plus-one.md)                     | When the optimizer cannot help, async DataLoader in `get_context`, priming, combining with the optimizer |

## Schema Design

| Topic                   | Reference                                                                  | Use for                                                                        |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Types and Fields        | [references/types-and-fields.md](references/types-and-fields.md)           | `@strawberry_django.type`, `auto`, computed fields, `get_queryset`, `model_property`, enum generation, field descriptions from `help_text` |
| Mutations               | [references/mutations.md](references/mutations.md)                         | `mutations.create/update/delete`, `NodeInput`, partial inputs, `handle_django_errors`, custom mutations, transaction atomicity, batch operations |
| Filters, Pagination, Relay | [references/filters-pagination-relay.md](references/filters-pagination-relay.md) | `@strawberry_django.filter`, custom `filter_field`, `@strawberry_django.order`, offset vs `DjangoListConnection` vs `DjangoCursorConnection`, `relay.Node` and `GlobalID` |

## Security

| Topic                  | Reference                                                                   | Use for                                                                      |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Permissions & Security | [references/permissions-and-security.md](references/permissions-and-security.md) | `IsAuthenticated`/`IsStaff`/`HasPerm`/`HasRetvalPerm`/`HasSourcePerm`, django-guardian object-level perms, `DisableIntrospection`, `QueryDepthLimiter`, `MaxTokensLimiter`, `MaxAliasesLimiter`, error masking |

## Async and Subscriptions

| Topic                     | Reference                                                                    | Use for                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Async and Subscriptions   | [references/async-and-subscriptions.md](references/async-and-subscriptions.md) | `AsyncGraphQLView`, `sync_to_async` ORM access, Channels + `AuthGraphQLProtocolTypeRouter`, broadcasting subscriptions, pitfalls mixing sync and async resolvers |

## Testing

| Topic   | Reference                                              | Use for                                                                                                  |
| ------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Testing | [references/testing.md](references/testing.md)         | `strawberry_django.test.client.TestClient`, `client.login()`, `assertNumQueries` for optimizer regressions, async tests, snapshot schema diffs |
