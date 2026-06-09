---
name: graphene-django
description: Graphene-Django best practices, N+1 prevention, query optimization, schema design, security, caching, and testing. Load when working with graphene-django GraphQL APIs.
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Graphene-Django

## N+1 and Data Loading

| Topic               | Reference                                                        | Use for                                                           |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| N+1 Problem         | [references/n-plus-one.md](references/n-plus-one.md)             | DataLoader pattern, resolver pitfalls, prefetch vs optimizer      |

## Query Optimization

| Topic              | Reference                                                                  | Use for                                                            |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Query Optimization | [references/query-optimization.md](references/query-optimization.md)       | Relay pagination, depth/complexity limiting, subquery patterns      |

## Schema Design

| Topic         | Reference                                                          | Use for                                                             |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Schema Design | [references/schema-design.md](references/schema-design.md)         | DjangoObjectType, enums, Relay Node vs plain, mutation patterns     |

## Security

| Topic    | Reference                                                  | Use for                                                              |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Security | [references/security.md](references/security.md)           | Depth limiting, introspection, query cost, auth in resolvers         |

## Caching

| Topic   | Reference                                              | Use for                                            |
| ------- | ------------------------------------------------------ | -------------------------------------------------- |
| Caching | [references/caching.md](references/caching.md)         | Query caching, persisted queries, ETag strategies   |

## Testing

| Topic   | Reference                                              | Use for                                              |
| ------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Testing | [references/testing.md](references/testing.md)         | GraphQL test patterns, snapshot testing, fixtures     |

## Django Integration

| Topic              | Reference                                                                | Use for                                                                |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Django Integration | [references/django-integration.md](references/django-integration.md)     | ConnectionField optimization, graphene-django-optimizer, transactions   |
