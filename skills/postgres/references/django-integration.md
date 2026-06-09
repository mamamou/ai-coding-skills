---
title: Django Integration
description: Django ORM optimization, connection pooling, zero-downtime migrations, contrib.postgres features, and N+1 prevention
tags: postgres, django, orm, migrations, connection-pooling, full-text-search, jsonfield
---

# Django Integration

Bridges PostgreSQL best practices to Django's ORM, migration framework, and `django.contrib.postgres`.

## Connection Pooling

### Native Connection Pooling (Django 5.1+, Recommended)

Django 5.1+ includes built-in connection pooling via `psycopg3`. Reduces connection overhead by 60–80% and improves response times by 10–30%.

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "mydb",
        "HOST": "localhost",
        "PORT": "5432",
        "USER": "app_user",
        "PASSWORD": "...",
        "CONN_MAX_AGE": 0,            # required for pooling
        "OPTIONS": {
            "pool": {
                "min_size": 2,         # minimum connections kept open
                "max_size": 10,        # max connections (start: concurrent_users / 10)
                "timeout": 10,         # seconds to wait for a connection
                "max_lifetime": 300,   # recycle connections after 5 min
                "max_idle": 300,       # close idle connections after 5 min
            },
        },
    }
}
```

Requires `psycopg[pool]` (`pip install "psycopg[pool]"`). This replaces the need for external PgBouncer in many cases.

### CONN_MAX_AGE (Without Pooling)

```python
DATABASES = {
    "default": {
        # ...
        "CONN_MAX_AGE": 600,  # reuse connections for 10 min (0 = close after each request)
    }
}
```

Set to `None` for unlimited reuse (only with connection pooling or limited workers). **Never use `None` with gunicorn's gevent/eventlet workers** — connections leak.

### PgBouncer Integration

When using PgBouncer in transaction pooling mode:

```python
DATABASES = {
    "default": {
        # ...
        "PORT": "6432",                    # PgBouncer port
        "DISABLE_SERVER_SIDE_CURSORS": True, # required for transaction pooling
        "CONN_MAX_AGE": 0,                 # let PgBouncer manage connection lifetime
    }
}
```

`DISABLE_SERVER_SIDE_CURSORS` is required because server-side cursors persist across transaction boundaries, which conflicts with transaction pooling.

### Adapter Choice

Use `psycopg3` (package: `psycopg`) — it's the actively maintained adapter. `psycopg2` is in maintenance mode. Django 4.2+ supports `psycopg3` natively via `django.db.backends.postgresql`.

## Query Optimization

### N+1 Detection and Prevention

```python
# BAD: N+1 — each iteration fires a query for related author
for book in Book.objects.all():
    print(book.author.name)            # 1 query per book

# GOOD: select_related — single JOIN query (ForeignKey, OneToOne)
for book in Book.objects.select_related("author").all():
    print(book.author.name)            # 1 query total

# GOOD: prefetch_related — separate query + Python join (ManyToMany, reverse FK)
for author in Author.objects.prefetch_related("books").all():
    print(author.books.all())          # 2 queries total
```

**Rule of thumb:** `select_related` for single-valued relationships (FK, OneToOne), `prefetch_related` for multi-valued (M2M, reverse FK).

### Column Selection

```python
# BAD: fetches all columns including large text/JSONB fields
users = User.objects.all()

# GOOD: only fetch needed columns (returns model instances)
users = User.objects.only("id", "name", "email")

# GOOD: defer heavy columns
users = User.objects.defer("profile_json", "bio")

# GOOD: values/values_list for read-only data (returns dicts/tuples, not model instances)
users = User.objects.values_list("id", "name", flat=False)
```

### Bulk Operations

```python
# BAD: N individual INSERTs
for item in items:
    Item.objects.create(**item)

# GOOD: single INSERT with multiple rows
Item.objects.bulk_create([Item(**item) for item in items], batch_size=1000)

# GOOD: batch UPDATE
Item.objects.filter(status="pending").update(status="active")

# GOOD: bulk_update for different values per row
items = Item.objects.filter(status="pending")
for item in items:
    item.status = compute_status(item)
Item.objects.bulk_update(items, ["status"], batch_size=1000)
```

### Aggregation and Annotation

```python
from django.db.models import Count, Avg, Q, F

# Push computation to the database instead of Python
Order.objects.aggregate(avg_total=Avg("total"), count=Count("id"))

# Annotate for per-row computed values
Author.objects.annotate(book_count=Count("books")).filter(book_count__gt=5)

# F() expressions — use database values without fetching to Python
Product.objects.filter(stock__lt=F("reorder_level"))
Product.objects.update(price=F("price") * 1.1)

# Conditional aggregation
User.objects.aggregate(
    active=Count("id", filter=Q(is_active=True)),
    inactive=Count("id", filter=Q(is_active=False)),
)
```

### Raw SQL (When Needed)

```python
# For queries the ORM can't express efficiently
from django.db import connection

with connection.cursor() as cursor:
    cursor.execute("""
        SELECT id, title FROM articles
        WHERE search_vector @@ websearch_to_tsquery('english', %s)
        ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', %s)) DESC
        LIMIT 20
    """, [query, query])
    results = cursor.fetchall()
```

## Django Indexing

### Model Meta Indexes

```python
from django.contrib.postgres.indexes import GinIndex, BTreeIndex, BrinIndex

class Article(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    status = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict)
    search_vector = SearchVectorField(null=True)

    class Meta:
        indexes = [
            # Composite B-tree (equality first, range second)
            models.Index(fields=["status", "created_at"], name="article_status_created_idx"),

            # GIN for JSONB
            GinIndex(fields=["metadata"], name="article_metadata_gin",
                     opclasses=["jsonb_path_ops"]),

            # GIN for full-text search
            GinIndex(fields=["search_vector"], name="article_search_gin"),

            # BRIN for time-series (append-only tables)
            BrinIndex(fields=["created_at"], name="article_created_brin"),

            # Partial index
            models.Index(
                fields=["created_at"],
                name="article_active_idx",
                condition=Q(status="active"),
            ),
        ]
```

### db_index on Fields

```python
class Order(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    # db_index=True creates a B-tree index — good for FK lookups
    email = models.EmailField(db_index=True)
```

Django auto-creates indexes on ForeignKey fields. Use `Meta.indexes` for composite, partial, GIN, or BRIN indexes.

## django.contrib.postgres Features

Add `'django.contrib.postgres'` to `INSTALLED_APPS`.

### JSONField

```python
class UserProfile(models.Model):
    preferences = models.JSONField(default=dict)

# Query JSONB fields
UserProfile.objects.filter(preferences__theme="dark")
UserProfile.objects.filter(preferences__notifications__email=True)

# Key existence
UserProfile.objects.filter(preferences__has_key="theme")
UserProfile.objects.filter(preferences__has_any_keys=["theme", "lang"])

# Containment (uses GIN index with @>)
UserProfile.objects.filter(preferences__contains={"theme": "dark"})
```

### ArrayField

```python
from django.contrib.postgres.fields import ArrayField

class Article(models.Model):
    tags = ArrayField(models.CharField(max_length=50), default=list)

# Query arrays
Article.objects.filter(tags__contains=["python"])
Article.objects.filter(tags__overlap=["python", "django"])
Article.objects.filter(tags__len__gte=3)

# Index for array queries
class Meta:
    indexes = [GinIndex(fields=["tags"], name="article_tags_gin")]
```

### Full-Text Search

```python
from django.contrib.postgres.search import (
    SearchVector, SearchQuery, SearchRank, SearchHeadline, TrigramSimilarity
)

# Basic search (generates tsvector on the fly — slow for large tables)
Article.objects.annotate(
    search=SearchVector("title", "body")
).filter(search=SearchQuery("django postgres"))

# Weighted search with ranking
vector = SearchVector("title", weight="A") + SearchVector("body", weight="B")
query = SearchQuery("django postgres")
Article.objects.annotate(
    rank=SearchRank(vector, query)
).filter(rank__gte=0.1).order_by("-rank")

# SearchVectorField (recommended for performance — pre-computed tsvector)
from django.contrib.postgres.search import SearchVectorField

class Article(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    search_vector = SearchVectorField(null=True)

    class Meta:
        indexes = [GinIndex(fields=["search_vector"], name="article_search_gin")]

# Update search vector (run after insert/update, or via trigger/signal)
Article.objects.update(
    search_vector=SearchVector("title", weight="A") + SearchVector("body", weight="B")
)

# Query the pre-computed field
Article.objects.filter(search_vector=SearchQuery("django"))

# Headline (highlighting)
query = SearchQuery("django")
Article.objects.annotate(
    headline=SearchHeadline("body", query, start_sel="<b>", stop_sel="</b>")
).filter(search_vector=query)

# Trigram similarity (fuzzy search — requires pg_trgm extension)
Article.objects.annotate(
    similarity=TrigramSimilarity("title", "djnago")
).filter(similarity__gt=0.3).order_by("-similarity")
```

## Zero-Downtime Migrations

### Safe Operations

| Django Migration | PostgreSQL Effect | Safe? |
|-----------------|-------------------|-------|
| `AddField` (nullable) | `ALTER TABLE ADD COLUMN` (metadata-only) | Yes |
| `AddField` (with default) | Metadata-only on PG 11+ | Yes |
| `AddField` (NOT NULL, no default) | Fails or rewrites table | **No** |
| `RemoveField` | `ALTER TABLE DROP COLUMN` (metadata-only) | Yes |
| `AddIndex` | `CREATE INDEX` (blocks writes) | **No** |
| `AlterField` (change type) | May rewrite table | **No** |
| `RenameField` | Brief `ACCESS EXCLUSIVE` | Caution |

### Safe Migration Patterns

**Adding a required field:**

```python
# Migration 1: Add nullable
class Migration(migrations.Migration):
    operations = [
        migrations.AddField(
            model_name="order",
            name="priority",
            field=models.CharField(max_length=20, null=True),
        ),
    ]

# Migration 2: Backfill (RunPython or RunSQL in batches)
class Migration(migrations.Migration):
    operations = [
        migrations.RunSQL(
            sql="UPDATE orders SET priority = 'normal' WHERE priority IS NULL;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]

# Migration 3: Set NOT NULL
class Migration(migrations.Migration):
    operations = [
        migrations.AlterField(
            model_name="order",
            name="priority",
            field=models.CharField(max_length=20, default="normal"),
        ),
    ]
```

**Adding an index without downtime:**

```python
# Use AddIndexConcurrently (requires non-atomic migration)
from django.contrib.postgres.operations import AddIndexConcurrently

class Migration(migrations.Migration):
    atomic = False  # REQUIRED for CONCURRENTLY

    operations = [
        AddIndexConcurrently(
            model_name="order",
            index=models.Index(fields=["customer_id"], name="order_customer_idx"),
        ),
    ]
```

**Adding a foreign key without long locks:**

```python
class Migration(migrations.Migration):
    operations = [
        # Step 1: Add FK with NOT VALID (no full table scan)
        migrations.RunSQL(
            sql="""
                ALTER TABLE orders
                ADD CONSTRAINT orders_customer_fk
                FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
            """,
            reverse_sql="ALTER TABLE orders DROP CONSTRAINT orders_customer_fk;",
        ),
        # Step 2: Validate separately (ROW SHARE lock, concurrent-safe)
        migrations.RunSQL(
            sql="ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_fk;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
```

### SeparateDatabaseAndState

When you need the database schema and Django's state to diverge (e.g., custom DDL):

```python
class Migration(migrations.Migration):
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="CREATE INDEX CONCURRENTLY ...",
                    reverse_sql="DROP INDEX CONCURRENTLY ...",
                ),
            ],
            state_operations=[
                migrations.AddIndex(
                    model_name="order",
                    index=models.Index(fields=["customer_id"], name="order_customer_idx"),
                ),
            ],
        ),
    ]
```

### Migration Libraries

- **django-pg-zero-downtime-migrations** — Custom PostgreSQL backend that wraps Django migrations with `SET lock_timeout`, `CREATE INDEX CONCURRENTLY`, and `NOT VALID` constraints automatically
- Set `statement_timeout` and `lock_timeout` in migrations via `RunSQL` when using the default backend

### Migration Rules

- **One operation per migration** for large tables — easier to debug and retry
- **Never mix data changes (RunPython) with schema changes** in the same migration
- **Test migrations against production-size data** — timing varies dramatically with table size
- `--fake` a migration only when you're certain the schema already matches
- Always check for `INVALID` indexes after `AddIndexConcurrently` failures

## Query Debugging

### Django Debug Toolbar

Essential for development — shows all SQL queries per request, duplicates, and timing.

### Logging All Queries

```python
# settings.py (development only)
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

### Explain in Django

```python
# Django 4.0+
print(MyModel.objects.filter(status="active").explain(analyze=True))
# Outputs: EXPLAIN ANALYZE output from PostgreSQL
```

### assertNumQueries (Testing)

```python
from django.test import TestCase

class OrderTest(TestCase):
    def test_list_orders(self):
        with self.assertNumQueries(2):  # fail if query count changes
            response = self.client.get("/api/orders/")
```
