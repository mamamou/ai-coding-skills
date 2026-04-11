---
title: Async and Subscriptions
description: Running strawberry-django async with AsyncGraphQLView, sync_to_async patterns for ORM access, Channels integration via AuthGraphQLProtocolTypeRouter, subscription broadcasting, and pitfalls when mixing sync and async resolvers
tags: strawberry-django, async, sync_to_async, AsyncGraphQLView, Channels, AuthGraphQLProtocolTypeRouter, subscriptions, daphne
---

# Async and Subscriptions

Strawberry is async-first. Strawberry-django runs both sync and async resolvers against Django's sync ORM by wrapping sync code in `sync_to_async` automatically when needed. For subscriptions, you must run ASGI (Daphne/Uvicorn/Hypercorn) and wire strawberry's router through Django Channels. This document covers the execution model, the pitfalls of mixing sync and async, and how subscriptions actually reach clients.

## Two Views, Two Execution Models

| View                  | Import path                            | Request model             | Subscriptions |
| --------------------- | -------------------------------------- | ------------------------- | ------------- |
| `GraphQLView`         | `strawberry.django.views.GraphQLView`  | WSGI, sync                | No            |
| `AsyncGraphQLView`    | `strawberry.django.views.AsyncGraphQLView` | ASGI, async            | HTTP only     |
| `AuthGraphQLProtocolTypeRouter` | `strawberry_django.routers` | ASGI + Channels routing | Yes           |

Rules of thumb:

- **Use `AsyncGraphQLView`** as the default for any new project. Async lets you run DataLoaders cheaply and prepares you for subscriptions.
- **Use `GraphQLView`** only if you have a legacy WSGI deployment and no plans to move. All resolvers will run on the request thread, which rules out parallel DataLoader batches.
- **Use `AuthGraphQLProtocolTypeRouter`** when you need subscriptions — it wraps the ASGI app so HTTP GraphQL and WebSocket GraphQL share the same schema and authentication.

### Wiring `AsyncGraphQLView`

```python
# urls.py
from django.urls import path
from strawberry.django.views import AsyncGraphQLView
from .schema import schema

urlpatterns = [
    path("graphql", AsyncGraphQLView.as_view(schema=schema)),
]
```

Run under an ASGI server:

```bash
pip install daphne  # or uvicorn[standard]
daphne myproject.asgi:application
```

## Writing Resolvers: Sync vs Async

A resolver can be sync or async. Strawberry-django will automatically wrap sync resolvers in `sync_to_async` when executed by the async view, so you can mix them freely — but the nuances matter.

### Sync Resolvers (Recommended for ORM-Heavy Code)

```python
@strawberry_django.type(Color)
class ColorType:
    id: auto
    name: auto

    @strawberry_django.field
    def fruits(self) -> list[FruitType]:
        return self.fruits.all()  # sync ORM — strawberry wraps it
```

This resolver runs inside a `sync_to_async` bubble. Django's ORM, forms, caches, and signals all work normally. For 95% of code that reads Django models, this is the right choice.

### Async Resolvers (Recommended for I/O Fan-Out)

```python
@strawberry_django.type(Book)
class BookType:
    @strawberry_django.field
    async def live_price(self, info: strawberry.Info) -> float:
        return await info.context["pricing_client"].get_price(self.isbn)

    @strawberry_django.field
    async def author(self, info: strawberry.Info) -> "AuthorType | None":
        return await info.context["author_loader"].load(self.author_id)
```

Async resolvers are the right choice whenever you need to `await` something: DataLoaders, HTTP clients, Redis, another GraphQL service.

### The Trap: Sync ORM Inside an Async Resolver

This crashes at runtime:

```python
@strawberry_django.field
async def author(self) -> "AuthorType":
    return self.author  # SynchronousOnlyOperation
```

Django detects sync ORM access from an async context and raises `SynchronousOnlyOperation`. Either drop the resolver to sync (and let strawberry wrap it), use the async ORM (`self.aauthor()` via the related-object `a*` methods on Django 4.2+), or wrap the access explicitly:

```python
from asgiref.sync import sync_to_async

@strawberry_django.field
async def author(self) -> "AuthorType":
    return await sync_to_async(lambda: self.author)()
```

For reads on simple relations, Django 4.2's async ORM is the cleanest option. For anything complex, wrap in `sync_to_async` and move on.

### `sync_to_async` Gotchas

- **Wrap the whole unit of work**, not each query. Opening and closing a sync bubble per query is expensive. If a resolver needs to run several queries together, make it sync or wrap the whole body once.
- **Transactions must stay inside the sync bubble.** `transaction.atomic()` is a thread-local construct. Do not `await` anything inside an `atomic()` block, or your commits and rollbacks will fire on a different thread than the queries they are supposed to wrap.
- **Database connections are per-thread.** Each `sync_to_async` call may get a new Django DB connection. Django handles this automatically, but it means you cannot rely on connection state (session variables, `SET`, etc.) persisting across calls.

## DataLoader in an Async Schema

See [n-plus-one.md](./n-plus-one.md) for the full pattern. The short version:

```python
from strawberry.django.views import AsyncGraphQLView
from strawberry.dataloader import DataLoader
from asgiref.sync import sync_to_async

async def load_authors(keys: list[int]) -> list["Author | None"]:
    rows = await sync_to_async(list)(Author.objects.filter(pk__in=keys))
    by_id = {a.pk: a for a in rows}
    return [by_id.get(k) for k in keys]

class CustomGraphQLView(AsyncGraphQLView):
    async def get_context(self, request, response=None):
        return {
            "request": request,
            "author_loader": DataLoader(load_fn=load_authors),
        }
```

Create one loader instance per request in `get_context`. Never share loaders between requests — they cache, and you will leak data across users.

## Subscriptions

A subscription is an async generator that yields events. Strawberry delivers each yield to subscribed clients until the generator returns.

```python
import asyncio
import strawberry

@strawberry.type
class Subscription:
    @strawberry.subscription
    async def count(self, target: int = 100) -> int:
        for i in range(target):
            yield i
            await asyncio.sleep(0.5)
```

That toy example streams integers. For anything useful you need a real event source: Redis pub/sub, Postgres `LISTEN`/`NOTIFY`, or Channels groups.

### Subscriptions Over Channels

Strawberry-django ships `AuthGraphQLProtocolTypeRouter` to combine HTTP and WebSocket GraphQL under a single ASGI application:

```python
# asgi.py
import os

from django.core.asgi import get_asgi_application
from strawberry_django.routers import AuthGraphQLProtocolTypeRouter

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myproject.settings")
django_asgi_app = get_asgi_application()

from .schema import schema  # import AFTER get_asgi_application

application = AuthGraphQLProtocolTypeRouter(
    schema,
    django_application=django_asgi_app,
)
```

```python
# settings.py
INSTALLED_APPS = [
    "daphne",
    # "channels",  # if you use channel layers
    "django.contrib.staticfiles",
    # ...
]

ASGI_APPLICATION = "myproject.asgi.application"
```

Two important details:

1. **Import the schema after `get_asgi_application()`.** Django's app registry must be populated before any ORM model is imported. Importing `schema` at the top of `asgi.py` will break with `AppRegistryNotReady`.
2. **Authentication is session-based** by default — `AuthGraphQLProtocolTypeRouter` plugs the Django session middleware into the WebSocket scope, so `info.context["request"].user` works in subscription resolvers. For token auth, either add a Channels middleware that reads the token and populates `scope["user"]`, or authenticate in the first subscription message.

### Broadcasting Events to Subscribers

Strawberry does not ship a pub/sub — use Channels' channel layer or Redis directly. A typical pattern:

```python
# publisher side — after a mutation
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

def publish_book_updated(book):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"book_{book.id}",
        {"type": "book.updated", "id": book.id},
    )

# subscription resolver — consumer side
@strawberry.type
class Subscription:
    @strawberry.subscription
    async def book_updated(self, info: strawberry.Info, id: strawberry.ID) -> BookType:
        channel_layer = get_channel_layer()
        channel_name = await channel_layer.new_channel()
        await channel_layer.group_add(f"book_{id}", channel_name)
        try:
            while True:
                event = await channel_layer.receive(channel_name)
                if event["type"] == "book.updated":
                    yield await sync_to_async(Book.objects.get)(pk=event["id"])
        finally:
            await channel_layer.group_discard(f"book_{id}", channel_name)
```

Points to note:

- Always `group_discard` in a `finally` block. Subscribers that disconnect without cleaning up leak channel registrations in the channel layer.
- Yield full objects, not just event payloads. The optimizer cannot rewrite a yielded `yield event` into a queryset-backed fetch; you need to load the freshest copy from the DB before yielding.
- Subscription resolvers should be cheap — do authentication and authorization once up front, not on every yield. Running `HasPerm` or a DB-backed ACL check for every event will not scale.

## When To Skip Subscriptions

Subscriptions are operationally expensive: long-lived connections, sticky routing, per-pod memory cost, and a whole second protocol to monitor. For many dashboards and feeds, a periodic `pollInterval` on the client (Apollo's `pollInterval`, URQL's `requestPolicy`) is simpler and cheaper than a real subscription. Reach for subscriptions when (a) the UX genuinely requires sub-second latency and (b) the number of concurrent subscribers is bounded. For everything else, poll.
