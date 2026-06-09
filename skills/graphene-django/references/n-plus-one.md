---
title: N+1 Problem in Graphene-Django
description: DataLoader pattern, how graphene resolvers bypass Django queryset optimization, DataLoader vs prefetch_related vs graphene-django-optimizer
tags: graphene-django, n-plus-one, dataloader, prefetch, optimizer, resolvers
---

# N+1 Problem in Graphene-Django

## Why Graphene Ignores Django's Queryset Optimization

Django's `select_related` and `prefetch_related` work at the queryset level. Graphene resolvers execute **per-field, per-object** — each resolver receives a single model instance and returns related data independently. The queryset optimizations you set on the root query are invisible to nested resolvers.

```python
# This prefetch is WASTED — graphene resolvers don't use it
class Query(graphene.ObjectType):
    all_authors = graphene.List(AuthorType)

    def resolve_all_authors(self, info):
        # prefetch_related here has no effect on nested book resolvers
        return Author.objects.prefetch_related("books").all()

# Each AuthorType.resolve_books fires a separate query
class AuthorType(DjangoObjectType):
    class Meta:
        model = Author

    # This resolver runs N times — one per author
    def resolve_books(self, info):
        return self.books.all()  # N+1 query
```

The prefetch *does* populate the cache on the queryset, but **only if** the resolver accesses the prefetched attribute via the same manager. If you override `resolve_books`, Django cannot use the prefetched cache — it fires a new query.

**Key insight:** If you define a custom resolver for a related field, `prefetch_related` on the parent queryset will not help. The resolver bypasses the prefetch cache.

## DataLoader Pattern

DataLoader batches individual lookups into a single query. It collects all keys requested within a single "tick" (one level of GraphQL resolution) and resolves them in one batch.

### Basic DataLoader

```python
from promise import Promise
from promise.dataloader import DataLoader

class BooksByAuthorLoader(DataLoader):
    def batch_load_fn(self, author_ids):
        # Single query for ALL requested authors
        books = Book.objects.filter(author_id__in=author_ids)

        # Group by author_id
        books_by_author = defaultdict(list)
        for book in books:
            books_by_author[book.author_id].append(book)

        # Return in same order as input keys
        return Promise.resolve([
            books_by_author.get(author_id, [])
            for author_id in author_ids
        ])
```

### Attaching DataLoaders to Context

Create loaders **per-request** — never share across requests (they cache results).

```python
# middleware.py
class DataLoaderMiddleware:
    def resolve(self, next, root, info, **args):
        if not hasattr(info.context, "loaders"):
            info.context.loaders = {
                "books_by_author": BooksByAuthorLoader(),
                "reviews_by_book": ReviewsByBookLoader(),
            }
        return next(root, info, **args)

# settings.py
GRAPHENE = {
    "MIDDLEWARE": [
        "myapp.middleware.DataLoaderMiddleware",
    ],
}
```

### Using DataLoaders in Resolvers

```python
class AuthorType(DjangoObjectType):
    class Meta:
        model = Author

    books = graphene.List(BookType)

    def resolve_books(self, info):
        return info.context.loaders["books_by_author"].load(self.id)
```

### DataLoader for Foreign Keys (Single Objects)

```python
class AuthorByIdLoader(DataLoader):
    def batch_load_fn(self, author_ids):
        authors = Author.objects.in_bulk(author_ids)
        return Promise.resolve([
            authors.get(author_id) for author_id in author_ids
        ])

class BookType(DjangoObjectType):
    class Meta:
        model = Book

    def resolve_author(self, info):
        return info.context.loaders["author_by_id"].load(self.author_id)
```

### DataLoader Key Rules

- **One loader instance per request** — loaders cache results; shared loaders leak data between users
- **Return values in the same order as input keys** — DataLoader maps results by index
- **Return `None` for missing keys** — don't skip them, or indices shift
- **Use `loader.prime(key, value)` to warm cache** when you already have the data (e.g., after a mutation)

## graphene-django-optimizer

Automatically optimizes querysets based on the GraphQL query AST — adds `select_related`, `prefetch_related`, and `only()` without manual DataLoaders.

```bash
pip install graphene-django-optimizer
```

### Setup

```python
import graphene_django_optimizer as gql_optimizer

class Query(graphene.ObjectType):
    all_authors = graphene.List(AuthorType)

    def resolve_all_authors(self, info):
        qs = Author.objects.all()
        return gql_optimizer.query(qs, info)
```

### How It Works

The optimizer inspects the incoming GraphQL query's selection set and:
1. Adds `select_related` for requested FK/OneToOne fields
2. Adds `prefetch_related` for requested M2M/reverse FK fields
3. Adds `only()` to limit selected columns to requested fields

```graphql
# This query:
{
  allAuthors {
    name
    books {
      title
      publisher { name }
    }
  }
}

# Generates approximately:
# Author.objects.prefetch_related(
#     Prefetch("books", queryset=Book.objects.select_related("publisher").only("title", "publisher__name"))
# ).only("name")
```

### Annotating Types for the Optimizer

```python
from graphene_django_optimizer import OptimizedDjangoObjectType, resolver_hints

class AuthorType(OptimizedDjangoObjectType):
    class Meta:
        model = Author

    # Tell optimizer about custom resolver dependencies
    @resolver_hints(
        select_related=("publisher",),
        prefetch_related=("awards",),
        only=("name", "bio"),
    )
    def resolve_full_profile(self, info):
        return self
```

### Limitations

- Does not work with custom resolvers that ignore the queryset (e.g., calling external APIs)
- Nested `Prefetch` objects with custom querysets may conflict with optimizer-generated prefetches
- Cannot optimize across DataLoader boundaries — use one approach or the other for a given relationship
- Does not handle computed/derived fields that depend on annotations

## When to Use What

| Approach | Best for | Trade-off |
| --- | --- | --- |
| `prefetch_related` on root queryset | Simple schemas where you don't override resolvers | Breaks if custom resolvers bypass the cache |
| DataLoader | Complex schemas, many nested levels, fine-grained control | Manual setup per relationship, requires middleware |
| graphene-django-optimizer | Moderate schemas, quick wins, automatic optimization | Less control, doesn't cover all edge cases |
| Optimizer + DataLoader | Large schemas — optimizer for simple relations, DataLoader for complex ones | More moving parts |

## Detecting N+1 in Development

```python
# settings.py — log all queries
LOGGING = {
    "version": 1,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "django.db.backends": {
            "level": "DEBUG",
            "handlers": ["console"],
        },
    },
}
```

Use `django-debug-toolbar` or `nplusone` to detect N+1 queries:

```bash
pip install nplusone
```

```python
# settings.py
INSTALLED_APPS += ["nplusone.ext.django"]
MIDDLEWARE.insert(0, "nplusone.ext.django.NPlusOneMiddleware")
NPLUSONE_RAISE = True  # raise exceptions on N+1 (dev only)
```

### assertNumQueries in Tests

```python
from django.test import TestCase

class AuthorQueryTest(TestCase):
    def test_all_authors_no_n_plus_one(self):
        # Create 50 authors with 3 books each
        for i in range(50):
            author = Author.objects.create(name=f"Author {i}")
            for j in range(3):
                Book.objects.create(title=f"Book {j}", author=author)

        query = """
            { allAuthors { name books { title } } }
        """
        with self.assertNumQueries(2):  # 1 for authors, 1 for books
            response = self.client.post(
                "/graphql/",
                {"query": query},
                content_type="application/json",
            )
```
