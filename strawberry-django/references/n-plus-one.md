---
title: N+1 and DataLoaders
description: When the DjangoOptimizerExtension cannot help — async DataLoader patterns, per-request context, priming, and how to combine DataLoaders with the optimizer without fighting it
tags: strawberry-django, dataloader, n-plus-one, async, context, priming
---

# N+1 and DataLoaders

[DjangoOptimizerExtension](./optimizer.md) solves most N+1 problems automatically. This document is about the cases where it cannot help, which is almost always "the field is not a plain queryset". Typical offenders:

- A resolver that calls an external API or cache.
- A polymorphic / `GenericForeignKey` relation.
- A field that aggregates across multiple models and cannot be expressed as a single `annotate`.
- A relation where you cannot sensibly use `prefetch_related` (e.g. the relation lives in another database, another service, or Elasticsearch).

For these, use strawberry's built-in `DataLoader`. It is async-native, so it composes with `AsyncGraphQLView` and Channels without any wrapping.

## Create Loaders Per-Request, Not Globally

A DataLoader **caches** — that is the point. If you create it once at module level, every request shares that cache, and user A will see user B's data. The only correct place to instantiate loaders is inside `get_context`, which is called once per request:

```python
from typing import Any, Optional, Union
from strawberry.django.views import AsyncGraphQLView
from strawberry.dataloader import DataLoader
from django.http import HttpRequest, HttpResponse

async def load_authors(keys: list[int]) -> list["Author | None"]:
    # Single query for ALL requested keys
    from asgiref.sync import sync_to_async
    rows = await sync_to_async(list)(
        Author.objects.filter(pk__in=keys)
    )
    by_id = {a.pk: a for a in rows}
    # MUST return results in the same order as input keys, None for misses
    return [by_id.get(k) for k in keys]


class CustomGraphQLView(AsyncGraphQLView):
    async def get_context(
        self,
        request: HttpRequest,
        response: Optional[HttpResponse] = None,
    ) -> Any:
        return {
            "request": request,
            "author_loader": DataLoader(load_fn=load_authors),
            "reviews_by_book_loader": DataLoader(load_fn=load_reviews_by_book),
        }
```

Wire the view in `urls.py`:

```python
from django.urls import path
from .views import CustomGraphQLView
from .schema import schema

urlpatterns = [
    path("graphql", CustomGraphQLView.as_view(schema=schema)),
]
```

**Rules**:

- One loader instance **per request**. Never cache them at module level.
- The batch function must return values **in the same order** as the input keys.
- Return `None` (not "skip") for missing keys, or indices will shift and data will be served under the wrong id.
- The batch function is `async` — wrap ORM access in `sync_to_async` (see [async-and-subscriptions.md](./async-and-subscriptions.md)).

## Using a Loader in a Resolver

```python
import strawberry
import strawberry_django
from strawberry import auto

@strawberry_django.type(Book)
class BookType:
    id: auto
    title: auto
    author_id: auto  # keep the FK column exposed — resolvers need it

    @strawberry_django.field
    async def author(self, info: strawberry.Info) -> "AuthorType | None":
        return await info.context["author_loader"].load(self.author_id)
```

Two things worth noting:

1. The resolver reads `self.author_id`, not `self.author`. Touching `self.author` would trigger the ORM to fetch the author — defeating the loader. The optimizer leaves `author_id` on the queryset even without asking because it is the FK column.
2. `load()` returns an awaitable. Strawberry's executor gathers all `load()` calls made within the same tick, dispatches a single batched call, and resolves each awaitable when the batch returns.

## Load-Many and Grouped Loaders

For reverse relations (one-to-many), group results by key in the batch function:

```python
from collections import defaultdict

async def load_reviews_by_book(book_ids: list[int]) -> list[list["Review"]]:
    from asgiref.sync import sync_to_async
    rows = await sync_to_async(list)(
        Review.objects.filter(book_id__in=book_ids)
    )
    grouped: dict[int, list[Review]] = defaultdict(list)
    for r in rows:
        grouped[r.book_id].append(r)
    return [grouped.get(k, []) for k in book_ids]


@strawberry_django.type(Book)
class BookType:
    @strawberry_django.field
    async def reviews(self, info: strawberry.Info) -> list["ReviewType"]:
        return await info.context["reviews_by_book_loader"].load(self.id)
```

## Priming the Cache From a Mutation

When a mutation already has the resulting object in memory, seed the loader so the next resolver does not refetch it:

```python
@strawberry.type
class Mutation:
    @strawberry_django.mutation
    async def create_author(self, info: strawberry.Info, name: str) -> AuthorType:
        author = await sync_to_async(Author.objects.create)(name=name)
        info.context["author_loader"].prime(author.pk, author)
        return author
```

Subsequent `author_loader.load(author.pk)` calls inside the same request return the primed value without a DB round trip.

## Combining With the Optimizer

The optimizer and DataLoaders are complementary — use both. The rule of thumb:

| Situation                                                                              | Use               |
| -------------------------------------------------------------------------------------- | ----------------- |
| Field is a plain relation on the model                                                 | Optimizer         |
| Field is a property expressible via `annotate` / `model_property`                      | Optimizer + hints |
| Field calls an external API, cache, or another service                                 | DataLoader        |
| Field is a `GenericForeignKey` / polymorphic                                           | DataLoader        |
| Field traverses a relation but needs custom per-object logic the optimizer cannot express | DataLoader        |

If a field is loaded by DataLoader, **do not also hint it** for the optimizer — the optimizer will issue a `prefetch_related`, and the DataLoader will then fire its own batch. You pay twice. Pick one strategy per relation and stick with it.

## Detecting N+1 in Development

Enable Django query logging during development:

```python
# settings.py
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "django.db.backends": {"handlers": ["console"], "level": "DEBUG"},
    },
}
```

and assert query counts in tests — the moment somebody adds a resolver that slips past the optimizer, the count will jump and the test will fail. See [testing.md](./testing.md) for `assertNumQueries` patterns.

`django-debug-toolbar` is invaluable for the SQL tab, but cannot trace queries across async resolvers cleanly — for async schemas, prefer the query-count assertion approach plus verbose logging.
