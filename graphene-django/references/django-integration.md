---
title: Django Integration
description: Optimizing querysets in ConnectionField, graphene-django-optimizer, transaction handling in mutations, signals, and middleware
tags: graphene-django, django, connectionfield, optimizer, transactions, middleware, signals
---

# Django Integration

## Optimizing Querysets in ConnectionField

### The Problem

`DjangoFilterConnectionField` and `DjangoConnectionField` execute the base queryset, then graphene resolvers run per-node. Without optimization, nested relations trigger N+1 queries.

### get_queryset on DjangoObjectType

Override `get_queryset` to apply `select_related`, `prefetch_related`, and `only()` at the type level. This runs before pagination slicing.

```python
from graphene_django import DjangoObjectType
import graphene

class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)
        fields = ("id", "title", "author", "publisher", "tags", "reviews")

    @classmethod
    def get_queryset(cls, queryset, info):
        return queryset.select_related(
            "author", "publisher"
        ).prefetch_related(
            "tags", "reviews"
        )
```

### Custom ConnectionField with Optimization

```python
from graphene_django.filter import DjangoFilterConnectionField

class OptimizedConnectionField(DjangoFilterConnectionField):
    @classmethod
    def resolve_queryset(cls, connection, queryset, info, args):
        qs = super().resolve_queryset(connection, queryset, info, args)
        # Apply optimization based on requested fields
        # The queryset is already filtered/paginated at this point
        return qs.select_related("author").prefetch_related("tags")
```

### Conditional Optimization Based on Requested Fields

```python
from graphql import FieldNode

def get_requested_fields(info):
    """Extract field names from the GraphQL selection set."""
    fields = set()
    for field_node in info.field_nodes:
        if field_node.selection_set:
            for selection in field_node.selection_set.selections:
                if isinstance(selection, FieldNode):
                    fields.add(selection.name.value)
                    # Handle edges -> node pattern
                    if selection.name.value == "edges" and selection.selection_set:
                        for edge_sel in selection.selection_set.selections:
                            if isinstance(edge_sel, FieldNode) and edge_sel.name.value == "node":
                                if edge_sel.selection_set:
                                    for node_sel in edge_sel.selection_set.selections:
                                        if isinstance(node_sel, FieldNode):
                                            fields.add(node_sel.name.value)
    return fields

class BookNode(DjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)

    @classmethod
    def get_queryset(cls, queryset, info):
        requested = get_requested_fields(info)

        if "author" in requested:
            queryset = queryset.select_related("author")
        if "publisher" in requested:
            queryset = queryset.select_related("publisher")
        if "tags" in requested:
            queryset = queryset.prefetch_related("tags")
        if "reviews" in requested:
            queryset = queryset.prefetch_related("reviews__user")

        return queryset
```

## graphene-django-optimizer

Automates queryset optimization by inspecting the GraphQL AST.

### Setup

```bash
pip install graphene-django-optimizer
```

```python
import graphene_django_optimizer as gql_optimizer
from graphene_django_optimizer import OptimizedDjangoObjectType

class AuthorNode(OptimizedDjangoObjectType):
    class Meta:
        model = Author
        interfaces = (graphene.relay.Node,)
        fields = ("id", "name", "bio", "books")

class BookNode(OptimizedDjangoObjectType):
    class Meta:
        model = Book
        interfaces = (graphene.relay.Node,)
        fields = ("id", "title", "author", "publisher", "tags")

class Query(graphene.ObjectType):
    all_books = DjangoFilterConnectionField(BookNode)

    def resolve_all_books(self, info, **kwargs):
        return gql_optimizer.query(Book.objects.all(), info)
```

### resolver_hints for Custom Resolvers

When the optimizer can't infer dependencies from the model:

```python
from graphene_django_optimizer import resolver_hints

class AuthorNode(OptimizedDjangoObjectType):
    class Meta:
        model = Author
        interfaces = (graphene.relay.Node,)

    published_books_count = graphene.Int()

    @resolver_hints(
        prefetch_related=("books",),
    )
    def resolve_published_books_count(self, info):
        return len([b for b in self.books.all() if b.status == "published"])

    @resolver_hints(
        select_related=("publisher", "publisher__country"),
        only=("name", "publisher__name", "publisher__country__name"),
    )
    def resolve_publisher_info(self, info):
        return f"{self.publisher.name} ({self.publisher.country.name})"
```

### Optimizer with Relay Connections

```python
class Query(graphene.ObjectType):
    all_authors = DjangoFilterConnectionField(AuthorNode)

    def resolve_all_authors(self, info, **kwargs):
        # Wrap ALL root querysets with gql_optimizer.query
        return gql_optimizer.query(Author.objects.all(), info)
```

The optimizer handles:
- `select_related` for FK fields in the selection set
- `prefetch_related` for M2M / reverse FK fields
- `only()` to limit columns to selected fields
- Nested prefetch optimization for deep queries

### When Optimizer Falls Short

- **Custom resolvers that call external services** — optimizer can't predict these
- **Computed fields with complex annotations** — use `resolver_hints` or switch to DataLoader
- **Conditional prefetches** — optimizer applies the same optimization regardless of filter args
- **Very deep nesting** — prefetch chains beyond 3 levels can be slower than DataLoader

## Transaction Handling in Mutations

### Basic Transaction Wrapping

```python
from django.db import transaction

class TransferFunds(graphene.Mutation):
    class Arguments:
        from_account_id = graphene.Int(required=True)
        to_account_id = graphene.Int(required=True)
        amount = graphene.Decimal(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, from_account_id, to_account_id, amount):
        with transaction.atomic():
            from_account = (
                Account.objects.select_for_update()
                .get(pk=from_account_id)
            )
            to_account = (
                Account.objects.select_for_update()
                .get(pk=to_account_id)
            )

            if from_account.balance < amount:
                raise Exception("Insufficient funds.")

            from_account.balance -= amount
            to_account.balance += amount
            from_account.save(update_fields=["balance"])
            to_account.save(update_fields=["balance"])

        return TransferFunds(ok=True)
```

### Transaction Decorator for All Mutations

```python
from functools import wraps
from django.db import transaction

def atomic_mutation(func):
    """Wrap mutation in a database transaction."""
    @wraps(func)
    def wrapper(cls, root, info, *args, **kwargs):
        with transaction.atomic():
            return func(cls, root, info, *args, **kwargs)
    return wrapper

class CreateOrder(graphene.Mutation):
    class Arguments:
        input = OrderInput(required=True)

    order = graphene.Field(OrderType)

    @classmethod
    @atomic_mutation
    def mutate(cls, root, info, input):
        order = Order.objects.create(**input)
        for item_data in input.pop("items", []):
            OrderItem.objects.create(order=order, **item_data)
        return CreateOrder(order=order)
```

### Global Transaction Middleware

Wrap every mutation in a transaction automatically:

```python
from django.db import transaction

class AtomicMutationMiddleware:
    def resolve(self, next, root, info, **args):
        if root is None and info.operation.operation.value == "mutation":
            with transaction.atomic():
                return next(root, info, **args)
        return next(root, info, **args)
```

### Transaction Savepoints for Partial Failures

```python
class BulkCreateBooks(graphene.Mutation):
    class Arguments:
        books = graphene.List(BookInput, required=True)

    created = graphene.List(BookType)
    errors = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, books):
        created = []
        errors = []

        with transaction.atomic():
            for i, book_data in enumerate(books):
                sid = transaction.savepoint()
                try:
                    book = Book.objects.create(**book_data)
                    created.append(book)
                    transaction.savepoint_commit(sid)
                except Exception as e:
                    transaction.savepoint_rollback(sid)
                    errors.append(f"Book {i}: {str(e)}")

        return BulkCreateBooks(created=created, errors=errors)
```

### Side Effects After Commit

Don't send emails, fire webhooks, or enqueue tasks inside a transaction — the transaction might roll back.

```python
from django.db import transaction

class CreateUser(graphene.Mutation):
    class Arguments:
        input = UserInput(required=True)

    user = graphene.Field(UserType)

    @classmethod
    def mutate(cls, root, info, input):
        with transaction.atomic():
            user = User.objects.create_user(**input)
            Profile.objects.create(user=user)

        # Only runs after the transaction commits successfully
        transaction.on_commit(lambda: send_welcome_email.delay(user.id))
        transaction.on_commit(lambda: notify_admin_new_user.delay(user.id))

        return CreateUser(user=user)
```

## Middleware Stack

### Recommended Middleware Order

```python
GRAPHENE = {
    "SCHEMA": "myapp.schema.schema",
    "MIDDLEWARE": [
        # 1. Rate limiting (reject early)
        "myapp.middleware.RateLimitMiddleware",
        # 2. Authentication
        "myapp.middleware.AuthenticationMiddleware",
        # 3. DataLoader initialization
        "myapp.middleware.DataLoaderMiddleware",
        # 4. Query cost / depth checks
        "myapp.middleware.QueryCostMiddleware",
        # 5. Transactions for mutations
        "myapp.middleware.AtomicMutationMiddleware",
        # 6. Query counting (debug only)
        # "myapp.middleware.QueryCountMiddleware",
    ],
}
```

## Django Signals with GraphQL

### Invalidating Caches on Model Changes

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache

@receiver([post_save, post_delete], sender=Book)
def invalidate_book_caches(sender, instance, **kwargs):
    cache.delete("graphql:all_books")
    cache.delete(f"graphql:author:{instance.author_id}:books")
```

### Avoiding Signal Side Effects in Mutations

Signals fire automatically on `save()` / `delete()`. If your mutation calls `bulk_create` or `update()`, signals don't fire. Be explicit about what triggers side effects.

```python
class UpdateBookStatus(graphene.Mutation):
    class Arguments:
        book_id = graphene.Int(required=True)
        status = graphene.String(required=True)

    book = graphene.Field(BookType)

    @classmethod
    def mutate(cls, root, info, book_id, status):
        # This fires post_save signal
        book = Book.objects.get(pk=book_id)
        book.status = status
        book.save(update_fields=["status"])

        # This does NOT fire signals — use if you don't need them
        # Book.objects.filter(pk=book_id).update(status=status)

        return UpdateBookStatus(book=book)
```

## URL Configuration

### Standard Setup

```python
from django.urls import path
from graphene_django.views import GraphQLView
from django.views.decorators.csrf import csrf_exempt

urlpatterns = [
    # CSRF exempt for API clients using token auth
    path("graphql/", csrf_exempt(GraphQLView.as_view(graphiql=True))),
]
```

### Production Setup

```python
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from myapp.views import SecureGraphQLView

urlpatterns = [
    path(
        "graphql/",
        csrf_exempt(SecureGraphQLView.as_view(
            graphiql=False,  # disable in production
            batch=False,     # disable batch queries unless needed
        )),
    ),
]
```

### CSRF Considerations

- **Token-based auth (JWT, API key):** Use `csrf_exempt` — tokens are not vulnerable to CSRF
- **Cookie/session-based auth:** Do NOT use `csrf_exempt` — enable CSRF protection. Send the CSRF token via `X-CSRFToken` header from the client
- **Mixed auth:** Use a custom view that conditionally enforces CSRF based on auth method

```python
from django.middleware.csrf import CsrfViewMiddleware

class ConditionalCSRFGraphQLView(GraphQLView):
    def dispatch(self, request, *args, **kwargs):
        # Skip CSRF for token-authenticated requests
        if request.META.get("HTTP_AUTHORIZATION"):
            return super().dispatch(request, *args, **kwargs)
        # Enforce CSRF for session/cookie auth
        reason = CsrfViewMiddleware(lambda r: None).process_view(request, None, (), {})
        if reason:
            return reason
        return super().dispatch(request, *args, **kwargs)
```

## Settings Reference

```python
GRAPHENE = {
    # Schema path
    "SCHEMA": "myapp.schema.schema",

    # Output format
    "SCHEMA_OUTPUT": "schema.graphql",
    "SCHEMA_INDENT": 2,

    # Middleware (executed in order)
    "MIDDLEWARE": [
        "graphene_django.debug.DjangoDebugMiddleware",  # debug only
    ],

    # Relay
    "RELAY_CONNECTION_MAX_LIMIT": 100,      # max items per page
    "RELAY_CONNECTION_ENFORCE_FIRST_OR_LAST": True,  # require first/last arg

    # Testing
    "TESTING_ENDPOINT": "/graphql/",
}
```
