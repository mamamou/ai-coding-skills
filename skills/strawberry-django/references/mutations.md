---
title: Mutations
description: Built-in CRUD mutations, NodeInput, partial inputs, handle_django_errors/OperationInfo, custom mutations, transactional atomicity, batch operations, and nested writes
tags: strawberry-django, mutations, create, update, delete, NodeInput, OperationInfo, transactions, batch
---

# Mutations

Strawberry-django ships **generated CRUD mutations**. You define an input type and a mutation field, and you get create/update/delete for free — with validation, error handling, and relay-aware IDs if you want them. You do not need to hand-roll `mutate` methods unless your logic is genuinely custom.

## Generated CRUD

```python
from strawberry import auto
import strawberry
import strawberry_django
from strawberry_django import mutations, NodeInput
from strawberry.relay import Node

@strawberry_django.type(Fruit)
class FruitType(Node):
    name: auto
    color: "ColorType"

@strawberry_django.input(Fruit)
class FruitInput:
    name: auto
    color: "ColorInput"

@strawberry_django.partial(Fruit)
class FruitInputPartial(NodeInput):
    name: auto
    color: "ColorInputPartial"

@strawberry.type
class Mutation:
    create_fruit: FruitType = mutations.create(FruitInput)
    update_fruit: FruitType = mutations.update(FruitInputPartial)
    delete_fruit: FruitType = mutations.delete(NodeInput)
```

That produces three mutations in the schema. `update` and `delete` use `NodeInput` (a single `id: GlobalID!` input), while `create` takes the full non-partial input.

### Why `NodeInput` for update/delete?

It forces clients to identify the record by **GlobalID**, which is type-scoped (`FruitType:42`). A client cannot accidentally pass a `Vegetable:42` to a `delete_fruit` mutation — the resolver will reject the mismatched type before touching the database. This is a small but real defence against IDOR bugs, and it is one of the main reasons to adopt `relay.Node` even if you are not using the full Relay client pattern.

### Updating by a Non-ID Field

If you must update or delete by some other unique column (`slug`, `email`, etc.), pass `key_attr`:

```python
@strawberry_django.partial(Fruit)
class FruitBySlugInput:
    slug: auto
    name: auto

@strawberry.type
class Mutation:
    update_fruit_by_slug: FruitType = mutations.update(
        FruitBySlugInput, key_attr="slug",
    )
```

Never let a client update by a non-unique column — `key_attr` must point to a field with a `unique=True` constraint, or you will silently update several rows at once.

## Error Handling: `OperationInfo`

Manual error handling is ugly in GraphQL. Strawberry-django solves it with a union return type: your mutation returns **either** the happy type **or** an `OperationInfo` with structured error messages.

```python
# settings.py
STRAWBERRY_DJANGO = {
    "MUTATIONS_DEFAULT_HANDLE_ERRORS": True,
}
```

With that flag on, every generated `mutations.create/update/delete` automatically catches Django's `ValidationError`, `ObjectDoesNotExist`, `PermissionDenied`, and `IntegrityError`, and returns an `OperationInfo`:

```graphql
enum OperationMessageKind {
  INFO
  WARNING
  ERROR
  PERMISSION
  VALIDATION
}

type OperationInfo {
  messages: [OperationMessage!]!
}

type OperationMessage {
  kind: OperationMessageKind!
  message: String!
  field: String
  code: String
}

union CreateFruitPayload = Fruit | OperationInfo
```

Custom mutations opt in per-mutation:

```python
from strawberry_django import mutation
from django.core.exceptions import ValidationError

@strawberry.type
class Mutation:
    @mutation(handle_django_errors=True)
    def create_fruit(self, name: str, color: str) -> FruitType:
        if color not in {"red", "yellow", "green"}:
            raise ValidationError({"color": "Invalid color."})
        return Fruit.objects.create(name=name, color=color)
```

Clients discriminate on the union with `__typename` and pick the error messages out of `OperationInfo.messages`. Each message carries a `field` (for form-style validation display) and a stable `code` (for client-side logic).

This pattern is much better than throwing raw exceptions because (1) errors become part of the GraphQL type system, and (2) it stops the schema from leaking Python tracebacks or ORM internals to clients.

## Transactional Atomicity

A mutation that creates a parent and several children must be atomic. Strawberry does not wrap mutations in a transaction for you — you wrap them yourself:

```python
from django.db import transaction

@strawberry.type
class Mutation:
    @mutation(handle_django_errors=True)
    def create_order_with_items(self, info, input: OrderInput) -> OrderType:
        with transaction.atomic():
            order = Order.objects.create(customer_id=input.customer_id)
            OrderItem.objects.bulk_create([
                OrderItem(order=order, product_id=item.product_id, qty=item.qty)
                for item in input.items
            ])
            return order
```

Two traps specific to GraphQL:

- **Multiple mutations in one request.** GraphQL allows a client to send several mutations in a single document; strawberry executes them **sequentially**, but each mutation runs in its own transaction (or none at all). If you need all-or-nothing semantics across several mutations, wrap the view in `ATOMIC_REQUESTS=True` for the GraphQL path, or expose a single coarse-grained mutation that composes the operations.
- **Async resolvers.** Django's ORM is sync, so your mutation code runs inside `sync_to_async`. Make sure the `transaction.atomic()` block stays inside the sync portion; do not `await` anything inside the block or you will leak out of the sync thread.

## Batch Mutations

Batch CUD takes a `list[InputType]`:

```python
@strawberry.type
class Mutation:
    create_fruits: list[FruitType] = mutations.create(list[FruitInput])
    update_fruits: list[FruitType] = mutations.update(list[FruitInputPartial])
    delete_fruits: list[FruitType] = mutations.delete(list[NodeInput])
```

Each batch runs in a single transaction. If any item fails validation, the whole batch rolls back — which is almost always what you want for bulk imports. For use cases where partial success is OK (e.g. bulk-tagging), run the items in a plain loop and return an `OperationInfo` per failure.

## Filtering on Mutations — Be Careful

Strawberry allows `mutations.update(..., filters=SomeFilter)` and `mutations.delete(filters=SomeFilter)`. **Do not expose this to untrusted clients.** A filter-based delete with a weak filter lets a client erase unbounded rows with a single call — `delete(filters: {})` would wipe the table.

```python
STRAWBERRY_DJANGO = {
    "ALLOW_MUTATIONS_WITHOUT_FILTERS": True,  # default True — think about False
}
```

Turning `ALLOW_MUTATIONS_WITHOUT_FILTERS=False` forces every filtered mutation to include a filter, closing the wipe-the-table footgun. On public-facing APIs, avoid filtered mutations entirely and stick to ID-keyed operations.

## Nested Writes

Strawberry-django understands nested input types for relations:

```python
@strawberry_django.input(Fruit)
class FruitInput:
    name: auto
    color: "ColorInput"  # forward FK

@strawberry_django.input(Color)
class ColorInput:
    id: auto          # presence of id → connect existing color
    name: auto        # absence of id → create new color
```

Sending `{ name: "Apple", color: { id: "Q29sb3I6NQ==" } }` connects to an existing color; sending `{ name: "Apple", color: { name: "Ruby" } }` creates a new one. For many-to-many relations (`list[ColorInput]`), strawberry will connect each item by id if present or create it otherwise.

For predictable behaviour, document explicitly which fields are "create vs connect" markers. Do not accept `id` on a nested input and then silently ignore mismatched extra fields — that is a common source of subtle data corruption.

## When to Drop the Generated Mutations

Generated mutations are great for plain CRUD. Write your own `@mutation` resolver when any of the following is true:

- The operation touches multiple models in non-obvious ways (e.g. transferring a record between two aggregates).
- You need to emit a side effect — Celery task, webhook, cache invalidation — after the write.
- The authorization logic is contextual (e.g. "you can only move a card to a list you own").
- The return type is a union of several result variants (e.g. `TransferSucceeded | InsufficientFunds | AccountFrozen`).

Handwritten mutations still benefit from `handle_django_errors=True`, and they still run inside the optimizer for their return values, so you do not lose anything by dropping down to custom code when the logic demands it.
