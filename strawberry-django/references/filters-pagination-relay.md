---
title: Filters, Ordering, Pagination, and Relay
description: Generated filter/order types, custom filter_field, offset vs DjangoListConnection vs DjangoCursorConnection, relay.Node, and GlobalID settings
tags: strawberry-django, filters, ordering, pagination, relay, connection, cursor, GlobalID
---

# Filters, Ordering, Pagination, and Relay

Strawberry-django generates filter, order, and pagination machinery from your Django models and decorated types. This document is about the tradeoffs between the three pagination strategies (offset, list-connection, cursor-connection), how to write custom filters safely, and how to configure Relay IDs.

## Filters

A filter type is declared the same way as an output type:

```python
from strawberry import auto
import strawberry_django

@strawberry_django.filter_type(Fruit, lookups=True)
class FruitFilter:
    id: auto
    name: auto
    color: auto
```

With `lookups=True`, each field gets the standard lookup set (`exact`, `iExact`, `contains`, `iContains`, `startsWith`, `endsWith`, `inList`, `isNull`, `regex`, …). The generated input looks like:

```graphql
input StrFilterLookup {
  exact: String
  iExact: String
  contains: String
  iContains: String
  startsWith: String
  endsWith: String
  inList: [String!]
  isNull: Boolean
  regex: String
}

input FruitFilter {
  id: IDBaseFilterLookup
  name: StrFilterLookup
  color: ColorFilter
  AND: FruitFilter
  OR: FruitFilter
  NOT: FruitFilter
  DISTINCT: Boolean
}
```

Attach the filter to a field by annotating the type:

```python
@strawberry_django.type(Fruit, filters=FruitFilter)
class FruitType:
    id: auto
    name: auto
    color: "ColorType"
```

Any query, connection, or mutation that resolves `FruitType` now accepts a `filters` argument.

### Custom `filter_field`

When a filter needs to do something the ORM cannot express directly — full-text search, cross-field search, computed columns — use `filter_field`:

```python
from django.db.models import Q, QuerySet
from django.db.models.functions import Concat
from django.db.models import Value

@strawberry_django.filter_type(User, lookups=True)
class UserFilter:
    email: auto

    @strawberry_django.filter_field
    def full_name(
        self,
        queryset: QuerySet,
        value: str,
        prefix: str,
    ) -> tuple[QuerySet, Q]:
        queryset = queryset.alias(
            _fullname=Concat(f"{prefix}first_name", Value(" "), f"{prefix}last_name")
        )
        return queryset, Q(_fullname__icontains=value)
```

The `prefix` argument is critical: it prepends the relation path when this filter is used through a reverse relation (e.g. `Team.filter(members: { fullName: "..." })`). If you hard-code the column name, the filter will crash the moment a client nests it.

### Never Build Filters From Raw Strings

When adding custom filters, never use `QuerySet.extra()` or `raw SQL` built from the input value. Use `Q` objects and parameterised ORM APIs. Strawberry will happily pass any input through, so SQL injection on a custom filter is a one-line mistake.

## Ordering

Ordering mirrors filters:

```python
@strawberry_django.order(Fruit)
class FruitOrder:
    name: auto
    price: auto

@strawberry_django.type(Fruit, order=FruitOrder)
class FruitType:
    ...
```

The generated schema accepts `order: { name: ASC, price: DESC }`. Nested ordering works across FK relations as long as the target type also has an order. For user-controlled ordering, be aware that some columns may not have indexes — large datasets ordered by a non-indexed column will do full table scans. Lock down which columns clients may order by by listing them explicitly rather than using `auto` on the entire model.

## Pagination — Pick One of Three

Strawberry-django offers three distinct pagination strategies. They are not interchangeable; pick based on the UX you need.

### 1. Offset Pagination

```python
from strawberry_django.pagination import OffsetPaginated

@strawberry.type
class Query:
    fruits: OffsetPaginated[FruitType] = strawberry_django.offset_paginated()
```

Schema:

```graphql
input OffsetPaginationInput {
  offset: Int! = 0
  limit: Int = null
}

type FruitOffsetPaginated {
  pageInfo: PaginationInfo!
  totalCount: Int!
  results: [Fruit!]!
}
```

- **Use when**: the UI shows page numbers (`1 2 3 … 42`) and users jump around.
- **Drawback**: offset scans all preceding rows on each page, so page 1000 of 10000 is slow. Unstable against inserts — if a row is added while the user is paging, items shift.
- **Safety**: cap `limit` with `STRAWBERRY_DJANGO["PAGINATION_DEFAULT_LIMIT"] = 250` and enforce a hard maximum in custom resolvers. Clients that can pass an unbounded `limit` can exfiltrate whole tables in one request.

### 2. `DjangoListConnection` (Relay, offset under the hood)

```python
from strawberry_django.relay import DjangoListConnection

@strawberry.type
class Query:
    fruits: DjangoListConnection[FruitType] = strawberry_django.connection()
```

- **Use when**: you want the Relay `edges`/`pageInfo` shape and a `totalCount` field, but you do not care about the inefficiency of offset-based paging.
- **What it is**: cursor-shaped API, offset-shaped performance. Good for compatibility with Relay clients on small-to-medium datasets.
- **Drawback**: same cost as offset pagination — the "cursor" is really an encoded index. Does not scale to large tables.

### 3. `DjangoCursorConnection` (true cursor pagination)

```python
from strawberry_django.relay import DjangoCursorConnection

@strawberry.type
class Query:
    fruits: DjangoCursorConnection[FruitType] = strawberry_django.connection()
```

- **Use when**: the UI is an infinitely-scrollable list and the underlying queryset has a stable ordering.
- **How it works**: the cursor encodes the values of the ordered columns, and the next page is fetched with a range query (`WHERE (created_at, id) > (last_seen_created_at, last_seen_id)`). This is **index-friendly** and constant-cost per page.
- **Requirements**:
  - The queryset must be **strictly ordered**. If two rows could compare equal by the order columns, strawberry falls back to ordering by primary key as a tiebreaker.
  - Cursors are only valid for the **order that generated them**. If users can switch sort order, you must discard existing cursors when the order changes — the client library usually handles this, but document it.
- **Drawback**: users cannot jump to "page 42" — only forward/backward from the current cursor.

Rule of thumb: **use `DjangoCursorConnection` for feeds and infinite scroll; use offset paging when product has decided page numbers matter**. Only use `DjangoListConnection` if you specifically need Relay shape on a small dataset.

## Relay Node and `GlobalID`

Opt into Relay by having your types inherit from `strawberry.relay.Node`:

```python
from strawberry.relay import Node

@strawberry_django.type(Fruit)
class FruitType(Node):
    name: auto
```

Strawberry-django automatically uses the Django PK as the `relay.NodeID`. Clients refer to objects by opaque `GlobalID`s (`base64("FruitType:42")`), which means:

- The same integer PK in two different models cannot be confused.
- The `node(id: ID!)` root query lets any client fetch any Node by its global id — useful for cache refetching.
- `NodeInput` in mutations uses the global id, so mismatched types are rejected at parse time.

If you want integer IDs everywhere else in the schema to remain real `Int`s while using `GlobalID` only for Nodes, leave `MAP_AUTO_ID_AS_GLOBAL_ID` at its default (`False`). If you want every auto-generated `id: auto` to become a `GlobalID`, enable it:

```python
STRAWBERRY_DJANGO = {
    "MAP_AUTO_ID_AS_GLOBAL_ID": True,
}
```

Choose one policy and stick with it — mixing integer and global ids in the same schema is confusing for clients.

## Filtering + Pagination Interaction

When filters and pagination (especially cursor pagination) are combined, the optimizer applies them in the right order: filter first, then cursor. A common bug is to compute the cursor before applying the filter — this breaks pagination in subtle ways because the cursor refers to rows that no longer exist in the filtered set. If you write a custom connection resolver, always apply filters before constructing the paginated slice.

For `DjangoCursorConnection`, changing the filter set invalidates existing cursors just as changing the order does. Clients that persist cursors across navigations (e.g. deep links) should fall back to "load from the top" if the cursor fails to resolve.
