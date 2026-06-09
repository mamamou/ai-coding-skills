---
title: Types, Fields, and Type Registration
description: Type-hint-first schema definition with @strawberry_django.type, the auto sentinel, computed fields, get_queryset, model_property, enums from TextChoices, and descriptions from help_text
tags: strawberry-django, types, fields, auto, get_queryset, model_property, enums, help_text
---

# Types, Fields, and Type Registration

Strawberry-Django's type system is **type-hint-first**: you declare a type as a Python dataclass-like block annotated with `@strawberry_django.type(Model)`, and each field is just a class annotation. The `auto` sentinel tells strawberry to infer the GraphQL type from the Django model field. There is no Meta inner class, no `fields = "__all__"`, and no class-level manager magic.

## The Basic Shape

```python
import strawberry_django
from strawberry import auto
from . import models

@strawberry_django.type(models.Fruit)
class FruitType:
    id: auto
    name: auto
    category: auto
    color: "ColorType"  # forward reference to another type

@strawberry_django.type(models.Color)
class ColorType:
    id: auto
    name: auto
    fruits: list[FruitType]  # reverse FK, auto-resolved by name
```

Key properties:

- **Explicit whitelisting is the only option**. There is no `fields = "__all__"`. You list exactly the fields you want exposed. This is by design — it eliminates the entire class of "new column accidentally exposed on next migration" bugs that plague Graphene's `exclude` approach.
- **`auto` infers from the Django model field**. A `CharField(max_length=200)` becomes `String!`, a `ForeignKey` becomes the related type, an `IntegerField(null=True)` becomes `Int`.
- **Relations are declared by annotation**. `color: "ColorType"` reads the model's `color` ForeignKey; `fruits: list[FruitType]` reads the reverse relation. You do not need to write resolvers for relations — the optimizer will fetch them.

## Input and Partial Input Types

For mutations, you need input equivalents. Strawberry generates them with the same decorator style:

```python
@strawberry_django.input(models.Fruit)
class FruitInput:
    name: auto
    color: "ColorInput"

@strawberry_django.input(models.Color)
class ColorInput:
    id: auto
    name: auto

# All auto-typed fields become optional in a partial input
@strawberry_django.partial(models.Fruit)
class FruitInputPartial:
    id: auto
    name: auto
    color: "ColorInputPartial"

@strawberry_django.partial(models.Color, partial=True)
class ColorInputPartial:
    id: auto
    name: auto
```

Partial inputs are required for `mutations.update` — they let clients PATCH a subset of fields without sending the whole object. See [mutations.md](./mutations.md).

## Computed Fields

Any method decorated with `@strawberry_django.field` becomes a GraphQL field. The return annotation determines the GraphQL type.

```python
@strawberry_django.type(models.Author)
class AuthorType:
    id: auto
    first_name: auto
    last_name: auto

    @strawberry_django.field
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
```

Because this resolver touches `first_name` and `last_name`, the optimizer needs a hint — otherwise its `only()` might drop those columns and hit the DB again:

```python
@strawberry_django.field(only=["first_name", "last_name"])
def full_name(self) -> str:
    return f"{self.first_name} {self.last_name}"
```

For computed fields that should remain available on the Django model too, use `model_property` (see [optimizer.md](./optimizer.md)). It lets you write the property once and then expose it as `full_name: auto` with the hints baked in.

## `get_queryset` for Row-Level Visibility

Every `@strawberry_django.type` can define a `get_queryset` classmethod. It runs **everywhere the type is resolved** — as a root query, as a relation on a parent type, or inside a mutation return. This is the right place for row-level visibility rules:

```python
from strawberry_django.auth.utils import get_current_user

@strawberry_django.type(models.Document)
class DocumentType:
    id: auto
    title: auto
    body: auto

    @classmethod
    def get_queryset(cls, queryset, info, **kwargs):
        user = get_current_user(info)
        if user.is_anonymous:
            return queryset.none()
        if user.is_staff:
            return queryset
        return queryset.filter(owner=user)
```

Important properties of `get_queryset`:

- It is called with the queryset you would have returned anyway, including any prior filters from filters/ordering/pagination.
- It runs **inside** the optimizer, so your filters are merged into the final rewritten queryset — you do not break optimization by adding `.filter(...)` here.
- It is the right place for visibility; it is **the wrong place** for auth. A query that should be completely rejected for unauthenticated users belongs behind a permission class (see [permissions-and-security.md](./permissions-and-security.md)), not a silent `.none()` that makes the user think the record does not exist.

## Enums From `TextChoices`

Strawberry-django can auto-generate GraphQL enums from Django `TextChoices`/`IntegerChoices`. Control this globally:

```python
# settings.py
STRAWBERRY_DJANGO = {
    "GENERATE_ENUMS_FROM_CHOICES": True,  # default: False
}
```

When enabled, a field like:

```python
class Book(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    status = models.CharField(max_length=20, choices=Status.choices)
```

is exposed as:

```graphql
enum BookStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

type Book {
  status: BookStatus!
}
```

If you need finer control (e.g. some fields as enums, some as strings), define the Python enum explicitly and annotate the field yourself instead of relying on `auto`.

**Gotcha**: enum auto-generation uses the **choice name**, not the value, as the enum case. Clients send `DRAFT`, and strawberry translates that back to the DB value `"draft"` for you. If you have legacy clients that send the raw value, either keep `GENERATE_ENUMS_FROM_CHOICES=False` or override the field with an explicit `str` type.

## Descriptions From `help_text`

Documentation is self-serve:

```python
# settings.py
STRAWBERRY_DJANGO = {
    "FIELD_DESCRIPTION_FROM_HELP_TEXT": True,
    "TYPE_DESCRIPTION_FROM_MODEL_DOCSTRING": True,
}
```

With these two flags:

- Every field's GraphQL description comes from its Django `help_text`.
- Every type's description comes from the model's docstring.

This is the easiest way to get a fully-documented schema without maintaining docs in two places. Team members who only ever touch `models.py` will still improve the GraphQL docs for free.

Override per field when needed:

```python
@strawberry_django.type(models.Book)
class BookType:
    id: auto
    title: auto = strawberry_django.field(description="Public title, marketing-approved.")
```

## Interface and Abstract-Model Support

Strawberry-django understands Django's multi-table inheritance. You can declare a type on the abstract parent and specialized types on each concrete subclass, and the optimizer will do the right thing. For polymorphic relations (`GenericForeignKey`, or `django-polymorphic`), the optimizer cannot introspect the target type, so those fields should be resolved through DataLoaders — see [n-plus-one.md](./n-plus-one.md).

## Do Not Expose Everything Just Because You Can

The combination of `auto` and automatic relation resolution makes it trivially easy to accidentally expose sensitive data. A few discipline points:

- Review every `auto` on the User model. `password`, `is_superuser`, `last_login` have no business being in the API.
- Reverse relations are picked up by name. `list[Payment]` on a `User` type will happily expose another user's payments unless `PaymentType.get_queryset` restricts them.
- `get_queryset` is your defence in depth — set it on every type that represents a privacy-sensitive model, even if the parent resolver already filters. Defence in depth means the filter still applies when the type is reached through a relation you didn't anticipate.
