---
title: Caching Strategies
description: Query-level caching, persisted queries, ETag strategies, and response caching for graphene-django
tags: graphene-django, caching, persisted-queries, etag, redis, cache
---

# Caching Strategies

## Why GraphQL Caching Is Different

REST endpoints map 1:1 to URLs — HTTP caching (CDN, browser, reverse proxy) works out of the box. GraphQL uses a single endpoint with POST requests and dynamic query bodies, making traditional HTTP caching ineffective.

Caching strategies for graphene-django:

1. **Resolver-level caching** — cache individual field resolutions
2. **Query result caching** — cache full query responses
3. **Persisted queries** — pre-register queries, cache by hash
4. **HTTP-level caching** — GET requests with query params for CDN caching

## Resolver-Level Caching

### Django Cache Framework

```python
from django.core.cache import cache

class Query(graphene.ObjectType):
    popular_books = graphene.List(BookType)

    def resolve_popular_books(self, info):
        cache_key = "graphql:popular_books"
        result = cache.get(cache_key)
        if result is not None:
            return result

        books = list(
            Book.objects.filter(status="published")
            .order_by("-popularity_score")[:20]
        )
        cache.set(cache_key, books, timeout=300)  # 5 minutes
        return books
```

### User-Specific Caching

```python
def resolve_my_recommendations(self, info):
    user = info.context.user
    if not user.is_authenticated:
        return []

    cache_key = f"graphql:recommendations:{user.id}"
    result = cache.get(cache_key)
    if result is not None:
        return result

    books = list(get_recommendations_for(user))
    cache.set(cache_key, books, timeout=600)
    return books
```

### Cache Invalidation on Mutations

```python
class CreateBook(graphene.Mutation):
    class Arguments:
        input = BookInput(required=True)

    book = graphene.Field(BookType)

    @classmethod
    def mutate(cls, root, info, input):
        book = Book.objects.create(**input)

        # Invalidate related caches
        cache.delete("graphql:popular_books")
        cache.delete_pattern("graphql:author_books:*")  # requires django-redis
        cache.delete(f"graphql:recommendations:{info.context.user.id}")

        return CreateBook(book=book)
```

### Caching Decorator

```python
from functools import wraps
from django.core.cache import cache

def cached_resolver(timeout=300, key_func=None):
    """Cache resolver results. key_func receives (root, info, **kwargs) and returns a cache key."""
    def decorator(func):
        @wraps(func)
        def wrapper(root, info, **kwargs):
            if key_func:
                cache_key = key_func(root, info, **kwargs)
            else:
                # Default key: resolver name + sorted args
                arg_str = ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
                cache_key = f"graphql:{func.__name__}:{arg_str}"

            result = cache.get(cache_key)
            if result is not None:
                return result

            result = func(root, info, **kwargs)
            # Materialize querysets before caching
            if hasattr(result, "__iter__") and hasattr(result, "query"):
                result = list(result)
            cache.set(cache_key, result, timeout)
            return result
        return wrapper
    return decorator

# Usage
class Query(graphene.ObjectType):
    trending_books = graphene.List(BookType)

    @cached_resolver(timeout=600)
    def resolve_trending_books(self, info):
        return Book.objects.filter(trending=True).order_by("-score")[:50]
```

## Query Result Caching

Cache entire GraphQL responses based on query + variables hash.

### Middleware Approach

```python
import hashlib
import json
from django.core.cache import cache

class QueryCacheMiddleware:
    """Cache full query results for anonymous/public queries."""

    CACHE_TIMEOUT = 300  # 5 minutes
    CACHEABLE_OPERATIONS = {"PopularBooks", "FeaturedAuthors", "BookCatalog"}

    def resolve(self, next, root, info, **args):
        # Only cache at the top level
        if root is not None:
            return next(root, info, **args)

        # Only cache specific named operations or anonymous queries
        operation_name = info.operation.name.value if info.operation.name else None
        if operation_name and operation_name not in self.CACHEABLE_OPERATIONS:
            return next(root, info, **args)

        # Don't cache mutations or authenticated requests
        if info.operation.operation.value == "mutation":
            return next(root, info, **args)
        if info.context.user.is_authenticated:
            return next(root, info, **args)

        # Generate cache key from query + variables
        query_str = info.context.body if hasattr(info.context, "body") else ""
        cache_key = f"graphql:response:{hashlib.sha256(query_str.encode()).hexdigest()}"

        result = cache.get(cache_key)
        if result is not None:
            return result

        result = next(root, info, **args)
        cache.set(cache_key, result, self.CACHE_TIMEOUT)
        return result
```

### View-Level Response Caching

```python
from django.views.decorators.cache import cache_page
from graphene_django.views import GraphQLView

# Cache GET requests for 5 minutes (works with persisted queries)
urlpatterns = [
    path(
        "graphql/",
        cache_page(300)(GraphQLView.as_view(graphiql=False)),
    ),
]
```

**Warning:** Only use view-level caching for fully public, unauthenticated queries. Authenticated queries will return cached data from other users.

## Persisted Queries

Pre-register allowed queries and reference them by hash. Benefits:
- **Security:** Reject arbitrary queries (allowlist only)
- **Performance:** Smaller request payloads, cacheable via GET + CDN
- **Bandwidth:** Hash is ~64 bytes vs. kilobytes of query text

### Automatic Persisted Queries (APQ)

Client sends a hash first. If the server doesn't recognize it, client resends with the full query, and the server caches it.

```python
import hashlib
from django.core.cache import cache
from graphene_django.views import GraphQLView

class PersistedQueryView(GraphQLView):
    PERSISTED_QUERY_CACHE_TIMEOUT = 86400  # 24 hours

    def get_query(self, request, data):
        """Support automatic persisted queries."""
        extensions = data.get("extensions", {})
        persisted = extensions.get("persistedQuery", {})

        if persisted and persisted.get("version") == 1:
            sha256_hash = persisted.get("sha256Hash")
            query = data.get("query")

            if query:
                # Client sent the full query — verify hash and cache it
                computed_hash = hashlib.sha256(query.encode()).hexdigest()
                if computed_hash != sha256_hash:
                    raise Exception("Persisted query hash mismatch.")
                cache.set(
                    f"persisted_query:{sha256_hash}",
                    query,
                    self.PERSISTED_QUERY_CACHE_TIMEOUT,
                )
                return query
            else:
                # Client sent only the hash — look up cached query
                cached_query = cache.get(f"persisted_query:{sha256_hash}")
                if cached_query is None:
                    from graphql import GraphQLError
                    raise GraphQLError("PersistedQueryNotFound")
                return cached_query

        return super().get_query(request, data)
```

### Static Persisted Queries (Allowlist)

For maximum security — only pre-approved queries can execute.

```python
import json
from pathlib import Path

# Load allowlist at startup
QUERY_ALLOWLIST = {}
allowlist_path = Path(__file__).parent / "persisted_queries.json"
if allowlist_path.exists():
    with open(allowlist_path) as f:
        QUERY_ALLOWLIST = json.load(f)
    # Format: {"sha256hash": "query { ... }", ...}

class AllowlistGraphQLView(GraphQLView):
    def get_query(self, request, data):
        extensions = data.get("extensions", {})
        persisted = extensions.get("persistedQuery", {})

        if persisted:
            sha256_hash = persisted.get("sha256Hash")
            query = QUERY_ALLOWLIST.get(sha256_hash)
            if not query:
                raise Exception("Query not in allowlist.")
            return query

        # In production, reject non-persisted queries entirely
        if not settings.DEBUG:
            raise Exception("Only persisted queries are allowed.")

        return super().get_query(request, data)
```

### Generating the Allowlist

```bash
# Extract queries from your frontend codebase
# With Apollo Client:
npx apollo client:extract --includes="src/**/*.{ts,tsx}" --tagName=gql persisted_queries.json

# Or build your own extractor that hashes each query:
# sha256(print(parse(query))) → query mapping
```

## HTTP GET for CDN Caching

GraphQL queries can be sent via GET with query params — enabling CDN/browser caching.

```python
# urls.py — enable GET requests
urlpatterns = [
    path(
        "graphql/",
        GraphQLView.as_view(graphiql=True, batch=False),
    ),
]

# GraphQLView already supports GET: ?query={books{title}}&variables={}
# CDN will cache based on the full URL including query params
```

Combine with persisted queries for compact, cacheable URLs:

```
GET /graphql/?extensions={"persistedQuery":{"version":1,"sha256Hash":"abc123"}}&variables={"first":10}
```

## Cache Configuration

### Redis Backend (Recommended)

```python
# settings.py
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": "redis://127.0.0.1:6379/1",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "SERIALIZER": "django_redis.serializers.json.JSONSerializer",
        },
        "KEY_PREFIX": "gql",
        "TIMEOUT": 300,
    }
}
```

### Cache Key Patterns

| Pattern | Example | TTL |
| --- | --- | --- |
| Public list queries | `gql:popular_books` | 5-15 min |
| User-specific data | `gql:recommendations:{user_id}` | 10-30 min |
| Persisted query store | `persisted_query:{hash}` | 24 hours |
| Full response cache | `gql:response:{query_hash}` | 1-5 min |
| Reference data (categories, tags) | `gql:categories` | 1 hour |

### Invalidation Strategies

- **TTL-based:** Simple, eventual consistency. Good for public data.
- **Signal-based:** Invalidate on model save/delete. More immediate.
- **Pattern-based:** Use `cache.delete_pattern("gql:author_books:*")` (requires django-redis).

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

@receiver([post_save, post_delete], sender=Book)
def invalidate_book_caches(sender, instance, **kwargs):
    cache.delete("gql:popular_books")
    cache.delete(f"gql:author_books:{instance.author_id}")
```
