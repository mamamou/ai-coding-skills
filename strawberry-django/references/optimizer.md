---
title: DjangoOptimizerExtension
description: How strawberry-django's built-in query optimizer walks the GraphQL AST to generate only()/select_related/prefetch_related/annotate, and how to hint fields that escape introspection
tags: strawberry-django, optimizer, DjangoOptimizerExtension, only, select_related, prefetch_related, annotate, hints
---

# DjangoOptimizerExtension

The optimizer is strawberry-django's signature feature. Unlike Graphene — where you either install a separate package or write DataLoaders by hand — the optimizer ships in strawberry-django and is the **first thing you should enable on any production schema**. It inspects the incoming GraphQL query and rewrites your root `QuerySet` so that a single tree of `select_related`/`prefetch_related`/`only`/`annotate` loads the exact data that will be returned.

## Enable It Once, Globally

```python
import strawberry
from strawberry_django.optimizer import DjangoOptimizerExtension

schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    extensions=[
        DjangoOptimizerExtension,
        # other extensions...
    ],
)
```

The optimizer runs as a schema **extension**, not a middleware. It hooks into the resolve lifecycle and, at the root of each operation, replaces the queryset you return with an optimized one that matches the selection set. Your resolvers can keep returning plain `Model.objects.all()` — the extension takes care of the rest.

## What the Optimizer Generates

Given these types:

```python
from strawberry import auto
import strawberry_django
from django.db.models import Count

@strawberry_django.type(Artist)
class ArtistType:
    name: auto
    albums: list["AlbumType"]
    albums_count: int = strawberry_django.field(annotate=Count("albums"))

@strawberry_django.type(Album)
class AlbumType:
    name: auto
    release_date: auto
    artist: ArtistType
    songs: list["SongType"]

@strawberry_django.type(Song)
class SongType:
    name: auto
    duration: auto
    album: AlbumType
```

a query like `{ artists { name albumsCount albums { name songs { name } } } }` is rewritten roughly as:

```python
Artist.objects.all().only("id", "name").prefetch_related(
    Prefetch(
        "albums",
        queryset=Album.objects.all().only("id", "name").prefetch_related(
            Prefetch("songs", Song.objects.all().only("id", "name")),
        ),
    ),
).annotate(albums_count=Count("albums"))
```

Things to notice:

- `only()` is applied at every level — you never pay for columns the client did not ask for.
- `prefetch_related` is used for reverse FKs and M2M; `select_related` is used automatically for forward FKs/O2O.
- The `annotate=` argument to `strawberry_django.field` is only applied when the client requests that field — it is cheap to add dozens of annotated fields to a type.
- `id` is always included even when the client does not select it, because the optimizer needs it to materialize related rows.

## Hinting Custom Resolvers

The optimizer can only introspect fields it understands. If you write a custom resolver it cannot see which model attributes you will touch, so the `only()` and relation hints are lost. Add them back with `strawberry_django.field(...)`:

```python
import decimal
from strawberry import auto
import strawberry_django
from .models import OrderItem

@strawberry_django.type(OrderItem)
class OrderItemType:
    price: auto
    quantity: auto

    @strawberry_django.field(only=["price", "quantity"])
    def total(self, root: OrderItem) -> decimal.Decimal:
        return root.price * root.quantity
```

Supported hint kwargs on `strawberry_django.field`:

| Hint                | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `only`              | Columns the resolver will read — keeps them in the generated `only()`.  |
| `select_related`    | Forward FK/O2O relations the resolver will traverse.                    |
| `prefetch_related`  | Reverse FK/M2M relations; accepts strings or `Prefetch(...)` objects.   |
| `annotate`          | `F()`/`Count()`/`Sum()` expression attached only when the field is asked. |

For a model property that several types reuse, move the hints onto the property itself with `model_property` so you do not repeat them:

```python
from strawberry_django.descriptors import model_property
from django.db import models

class OrderItem(models.Model):
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.IntegerField()

    @model_property(only=["price", "quantity"])
    def total(self) -> "decimal.Decimal":
        return self.price * self.quantity
```

Now `total: auto` on any `OrderItemType` resolves through the property **and** carries the optimizer hints.

## Where the Optimizer Stops Being Enough

The optimizer does the right thing for the vast majority of queries, but it has blind spots:

- **Custom resolvers that do not return a queryset** — e.g. a resolver that calls an external API, aggregates across multiple models, or builds a dict. The optimizer cannot rewrite what it does not see. Use a DataLoader for these; see [n-plus-one.md](./n-plus-one.md).
- **Nested custom `Prefetch` objects**. If you pass a hand-crafted `Prefetch(..., queryset=...)` through `prefetch_related=`, be careful: the optimizer does not recursively rewrite the inner queryset, so its `only()` will not be optimized. Either trust the optimizer for the whole chain or accept that your inner queryset is fixed.
- **Polymorphic / GenericForeignKey fields**. The optimizer cannot introspect a relation whose target type is chosen at runtime. Resolve these with DataLoaders keyed on `(content_type_id, object_id)`.
- **Queries that need row-level permissions from another table**. If your `get_queryset` joins a `UserAccess` table, the optimizer will honour it, but you must apply that filter in `get_queryset` — not in a resolver — so it is visible to the prefetch chain.

Rule of thumb: **return a queryset from your resolver whenever possible**. Every resolver that returns a plain list, dict, or Python object is a place the optimizer cannot help you.

## Interaction With `get_queryset`

Both the type-level `get_queryset` classmethod (for row-level visibility) and the resolver-level queryset are fed through the optimizer. You can safely filter, order, and even annotate in `get_queryset`; the optimizer will merge its own rewrites on top:

```python
from strawberry_django.auth.utils import get_current_user

@strawberry_django.type(Document)
class DocumentType:
    id: auto
    title: auto

    @classmethod
    def get_queryset(cls, queryset, info, **kwargs):
        user = get_current_user(info)
        if user.is_anonymous:
            return queryset.none()
        if not user.is_staff:
            queryset = queryset.filter(owner=user)
        return queryset
```

The optimizer will still add `only("id", "title")` and any required relations on top of your filter.

## Debugging the Optimizer

When you suspect the optimizer is not doing what you think, set `DEBUG=True` and log queries with `django.db.backends` — the optimizer's rewrites appear as normal ORM queries, so the query log is the source of truth. Pair this with `assertNumQueries` in your tests (see [testing.md](./testing.md)) to lock in the expected count and catch regressions when somebody adds a resolver that escapes optimization.

If a query count spikes, the cause is almost always one of:

1. A new custom resolver without hints → add `only=` / `prefetch_related=`.
2. A property on the model that reads a relation → decorate with `model_property` or move the logic to a hinted `@strawberry_django.field`.
3. A resolver that returns `list(qs)` instead of the queryset — the moment you materialize the queryset, the optimizer can no longer touch it.
