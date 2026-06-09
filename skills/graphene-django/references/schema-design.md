---
title: Schema Design
description: DjangoObjectType best practices, enum handling, Relay Node vs plain type trade-offs, mutation patterns
tags: graphene-django, schema, djangoobjecttype, enum, relay, node, mutations
---

# Schema Design

## DjangoObjectType Best Practices

### Field Exposure Control

Never expose all model fields by default — explicitly whitelist fields:

```python
class UserType(DjangoObjectType):
    class Meta:
        model = User
        # GOOD: explicit whitelist
        fields = ("id", "username", "email", "date_joined")

        # BAD: exposes everything including password hashes, tokens, etc.
        # fields = "__all__"

        # ALTERNATIVE: exclude sensitive fields (less safe — new fields auto-exposed)
        # exclude = ("password", "last_login", "is_superuser")
```

**Rule:** Always use `fields` (whitelist), never `fields = "__all__"`. The `exclude` approach is fragile — new model fields are exposed automatically.

### Description and Deprecation

```python
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "author", "isbn", "old_slug")
        description = "A published book in the catalog."

    # Deprecate fields instead of removing (backwards compatibility)
    old_slug = graphene.String(deprecation_reason="Use `id` for lookups instead.")
```

### Computed Fields

```python
class AuthorType(DjangoObjectType):
    class Meta:
        model = Author
        fields = ("id", "first_name", "last_name")

    full_name = graphene.String(description="First and last name combined.")
    book_count = graphene.Int(description="Total number of published books.")

    def resolve_full_name(self, info):
        return f"{self.first_name} {self.last_name}"

    def resolve_book_count(self, info):
        # Use annotation instead of self.books.count() to avoid N+1
        if hasattr(self, "book_count_annotation"):
            return self.book_count_annotation
        return self.books.count()
```

### get_queryset for Base Filtering

```python
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "author", "status")

    @classmethod
    def get_queryset(cls, queryset, info):
        """Applied everywhere this type is resolved — enforce visibility rules here."""
        user = info.context.user
        if user.is_staff:
            return queryset
        return queryset.filter(status="published")
```

## Enum Handling

### Django TextChoices → Graphene Enum

```python
# models.py
class Book(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    status = models.CharField(max_length=20, choices=Status.choices)

# schema.py — graphene-django auto-converts choices to enums
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "status")
        # convert_choices_to_enum = True  # default behavior
```

Graphene-django automatically converts `choices` fields to GraphQL enums. The enum values are uppercased versions of the choice values (e.g., `DRAFT`, `PUBLISHED`).

### Disabling Auto-Conversion

```python
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "status")
        # Disable enum conversion for specific fields
        convert_choices_to_enum = False  # returns plain strings

        # Or disable for specific fields only
        # convert_choices_to_enum = ["status"]  # only convert 'status'
```

### Custom Enums

```python
import graphene

class BookStatusEnum(graphene.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"

class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title")
        convert_choices_to_enum = False

    status = graphene.Field(BookStatusEnum)
```

### Enum Gotchas

- **Enum values in mutations:** Clients send the enum name (`PUBLISHED`), not the DB value (`published`). Your mutation must handle the conversion.
- **Filtering with enums:** `DjangoFilterConnectionField` handles enum-to-value conversion automatically if you keep `convert_choices_to_enum = True`.
- **Schema inconsistency:** If two DjangoObjectTypes reference the same model field with different `convert_choices_to_enum` settings, you get duplicate or conflicting types. Keep it consistent.

## Relay Node vs Plain Type

### Plain Types

```python
class BookType(DjangoObjectType):
    class Meta:
        model = Book
        fields = ("id", "title", "author")

class Query(graphene.ObjectType):
    book = graphene.Field(BookType, id=graphene.Int(required=True))
    all_books = graphene.List(BookType)

    def resolve_book(self, info, id):
        return Book.objects.get(pk=id)

    def resolve_all_books(self, info):
        return Book.objects.all()
```

### Relay Node Types

```python
class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)
        fields = ("id", "title", "author")

class Query(graphene.ObjectType):
    book = graphene.relay.Node.Field(BookNode)
    all_books = DjangoFilterConnectionField(BookNode)

    # No resolvers needed — Relay handles lookup by global ID
```

### Trade-offs

| Aspect | Plain Type | Relay Node |
| --- | --- | --- |
| ID format | Integer/UUID (model PK) | Global ID (base64 `Type:pk`) |
| Pagination | Manual (offset/limit) | Cursor-based (edges/pageInfo) |
| Caching | Client must know type + ID | Global ID enables normalized caching |
| Refetching | Custom query per type | Universal `node(id: "...")` query |
| Filtering | Manual argument handling | `DjangoFilterConnectionField` built-in |
| Complexity | Simpler schema, less boilerplate | More structure, more conventions |
| Client libraries | Works with any client | Best with Relay client, works with Apollo |

**Recommendation:** Use Relay Nodes for list/connection endpoints (pagination, filtering). Use plain types for simple single-object lookups or when clients don't use Relay.

### Mixing Both

You can expose the same model as both:

```python
class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)
        fields = ("id", "title", "author")

class Query(graphene.ObjectType):
    # Relay connection with pagination
    all_books = DjangoFilterConnectionField(BookNode)

    # Plain lookup by integer PK (convenience)
    book_by_pk = graphene.Field(BookNode, pk=graphene.Int(required=True))

    def resolve_book_by_pk(self, info, pk):
        return Book.objects.get(pk=pk)
```

## Mutation Patterns

### Plain Mutation

```python
class CreateBook(graphene.Mutation):
    class Arguments:
        title = graphene.String(required=True)
        author_id = graphene.Int(required=True)
        isbn = graphene.String()

    book = graphene.Field(BookType)
    errors = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, title, author_id, isbn=None):
        try:
            author = Author.objects.get(pk=author_id)
        except Author.DoesNotExist:
            return CreateBook(book=None, errors=["Author not found"])

        book = Book.objects.create(title=title, author=author, isbn=isbn)
        return CreateBook(book=book, errors=[])
```

### Relay ClientIDMutation

```python
class CreateBookMutation(graphene.relay.ClientIDMutation):
    class Input:
        title = graphene.String(required=True)
        author_id = graphene.ID(required=True)
        isbn = graphene.String()

    book = graphene.Field(BookNode)
    errors = graphene.List(graphene.String)

    @classmethod
    def mutate_and_get_payload(cls, root, info, title, author_id, isbn=None, **kwargs):
        # author_id arrives as a global ID — decode it
        _, pk = from_global_id(author_id)
        try:
            author = Author.objects.get(pk=pk)
        except Author.DoesNotExist:
            return CreateBookMutation(book=None, errors=["Author not found"])

        book = Book.objects.create(title=title, author=author, isbn=isbn)
        return CreateBookMutation(book=book, errors=[])
```

### Input Types for Complex Mutations

```python
class BookInput(graphene.InputObjectType):
    title = graphene.String(required=True)
    author_id = graphene.Int(required=True)
    isbn = graphene.String()
    tags = graphene.List(graphene.String)
    metadata = graphene.JSONString()

class CreateBook(graphene.Mutation):
    class Arguments:
        input = BookInput(required=True)

    book = graphene.Field(BookType)

    @classmethod
    def mutate(cls, root, info, input):
        book = Book.objects.create(**{
            k: v for k, v in input.items() if v is not None
        })
        return CreateBook(book=book)
```

### Django Form / Serializer Integration

```python
from graphene_django.forms.mutation import DjangoFormMutation, DjangoModelFormMutation

class BookForm(forms.ModelForm):
    class Meta:
        model = Book
        fields = ("title", "author", "isbn")

class CreateBookMutation(DjangoModelFormMutation):
    class Meta:
        form_class = BookForm
        # Returns the model instance and form errors automatically
```

### Mutation Conventions

- **Return the mutated object** so the client can update its cache without a refetch
- **Return structured errors** — use a list of error objects, not just strings:

```python
class ErrorType(graphene.ObjectType):
    field = graphene.String()
    messages = graphene.List(graphene.String)

class CreateBook(graphene.Mutation):
    class Arguments:
        input = BookInput(required=True)

    book = graphene.Field(BookType)
    errors = graphene.List(ErrorType)
    ok = graphene.Boolean()
```

- **Use `ok` boolean** for quick success/failure checking without inspecting errors
- **Validate with Django forms or serializers** — don't reinvent validation in mutate()
- **One mutation per operation** — avoid "upsert" mutations that do too many things
