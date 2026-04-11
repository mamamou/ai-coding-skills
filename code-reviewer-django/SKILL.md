---
name: code-reviewer-django
description: >
  Django/Python-specific code review overlay. Extends the universal code-reviewer skill
  with Django and Python version-aware rules. Trigger when reviewing Django views, models,
  serializers, forms, URLs, settings, migrations, Celery tasks, or any .py file in a
  Django project. Keywords: Django, DRF, ORM, QuerySet, serializer, viewset, model,
  migration, WSGI, ASGI, Celery, pytest-django. Do NOT trigger for pure Python scripts
  unrelated to Django, or for frontend code in the same project (use code-reviewer-react
  or code-reviewer-node for those).
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Code Reviewer — Django Overlay

This skill extends `code-reviewer` (the universal skill). Always apply the universal
skill's full checklist first, then apply the Django-specific rules in this file on top.

**Composition order:**
1. Run `code-reviewer` (universal pillars: correctness, security, performance, DRY, tests, docs)
2. Run this overlay (Django/Python-specific rules below)
3. Report findings from both in a single unified output

---

## Step 0 — Detect Versions First (always, before reviewing anything)

Run these commands before touching any code. Version determines which rules apply.

```bash
# Python version
python --version
cat .python-version 2>/dev/null

# Django version
python -c "import django; print(django.get_version())"

# Key package versions
pip show djangorestframework celery | grep -E "^(Name|Version)"

# Check if project uses ASGI or WSGI
grep -r "application = " */asgi.py */wsgi.py 2>/dev/null | head -5
```

Report at the top of your review:
```
🔍 Environment: Python X.Y | Django X.Y | DRF X.Y (if present) | WSGI/ASGI
```

Then apply the version-specific rules below that match.

---

## Django Version Rules

### Django 3.x
- ORM is **fully synchronous** — never use `async def` views with ORM calls without `sync_to_async()`. Flag `SynchronousOnlyOperation` risk.
- Async views available from 3.1 but ORM is not async-safe — flag any async view that calls the ORM directly without wrapping.
- No `acreate()`, `aget()`, `afilter()` — these don't exist yet; flag if used.
- `X_FRAME_OPTIONS` defaults to `DENY` since 3.0 — flag any override that weakens it.

### Django 4.x
- **4.1+**: Async ORM methods available (`acreate`, `aget`, `asave`, `adelete`, `aiterator`) — prefer these in async views over `sync_to_async()` wrapping.
- **4.1+**: Async class-based views supported — verify `async def get()` / `async def post()` handlers are used correctly.
- **4.2 LTS**: Last version to support Python 3.8/3.9 — flag if project targets 4.2 but uses Python 3.10+ features.
- Transactions still do **not** work in async mode in 4.x — flag `async` views that use `transaction.atomic()` without sync wrapping.
- `Signal.asend()` / `Signal.asend_robust()` not yet available — flag async signal dispatch attempts.

### Django 5.x
- **5.0+**: `GeneratedField` and `db_default` are available — flag Python-side computed defaults that could be `db_default=Now()` or a `GeneratedField`.
- **5.0+**: Most decorators now wrap async views — flag any manual `sync_to_async(decorator)` workarounds that are now unnecessary.
- **5.0+**: `asyncio.CancelledError` available for async disconnect cleanup — flag missing cleanup in async views with long-held connections.
- **5.2 LTS**: MySQL 5.7 is no longer supported — flag `mysql-connector` or settings targeting MySQL < 8.0.
- **5.2+**: Async auth methods available (`acheck_password`, async permissions) — flag sync auth calls in async views.

---

## Python Version Rules

- **Python 3.8/3.9**: No `match/case`, no `X | Y` union types, no `dict | dict` merge operator. Flag if used on these versions.
- **Python 3.10+**: `match/case` available — flag verbose `if/elif` chains on Django model state that could be a `match`.
- **Python 3.12+/3.13+**: Preferred for new projects. Use `target-version = "py312"` or `"py313"` in `ruff.toml`.
- Always flag: missing type hints on function signatures in a project that has adopted typing.

---

## Django-Specific Review Checklist

Work through each section. Skip if not relevant to the files being reviewed.

### 🗄️ ORM & QuerySet
- **N+1 queries** — flag any loop that accesses a related object without `select_related()` or `prefetch_related()`.
  ```python
  # ❌ N+1
  for order in Order.objects.all():
      print(order.user.email)  # query per order

  # ✅ Fixed
  for order in Order.objects.select_related('user'):
      print(order.user.email)
  ```
- **Raw SQL** — flag `cursor.execute()` or `Model.objects.raw()` with f-strings or string concatenation. Must use parameterized queries: `cursor.execute("... WHERE id = %s", [user_input])`.
- **Bulk operations** — flag loops with `.save()` inside that could use `bulk_create()` or `bulk_update()`.
- **QuerySet evaluation** — flag accidental early evaluation (e.g. `list()` on a queryset before filtering is complete).
- **`only()` / `defer()`** — flag queries that load all fields when only a subset is needed.
- **`values()` / `values_list()`** — suggest for read-only, non-model use cases to reduce memory overhead.
- **`exists()` vs `count()`** — flag `count() > 0` checks; use `exists()` instead.
- **`get()` without try/except** — flag bare `Model.objects.get()` without catching `DoesNotExist`.
- **Async ORM (4.1+)** — in async views, flag sync ORM calls not wrapped in `sync_to_async()` or not using `a`-prefixed methods.

### 🏗️ Models
- `CharField` and `TextField` — flag `null=True` on string fields; Django convention is `blank=True` only (empty string, not NULL).
- `ForeignKey` — flag missing `on_delete` argument (required since Django 2.0).
- `ForeignKey` — flag missing `related_name` on fields that will be reverse-accessed.
- Custom managers — flag overriding `get_queryset()` without calling `super()`.
- `Meta.ordering` — flag models with `ordering` set that also use `.order_by()` everywhere (redundant).
- `__str__` — flag models missing a `__str__` method.
- Migrations — flag `makemigrations` skipped after model changes (check if migration files match model state).
- `GeneratedField` (5.0+) — suggest replacing `@property` fields that only read other model fields.

### 👁️ Views & URLs
- **Fat views** — flag views doing business logic directly; suggest moving to service layer or model methods.
- **`get_object_or_404`** — flag bare `Model.objects.get()` in views where `get_object_or_404` is more appropriate.
- **Permission checks** — flag views missing `@login_required`, `permission_required`, or `IsAuthenticated` (DRF).
- **CSRF** — flag views that disable CSRF (`@csrf_exempt`) without documented justification.
- **Class-based views** — flag overriding `dispatch()` for logic that belongs in `get()` / `post()`.
- **URL naming** — flag hardcoded URL strings in views; use `reverse()` or `{% url %}`.

### 🔌 Django REST Framework (if present)
- **Serializer validation** — flag missing `validate_<field>()` or `validate()` methods for business rules.
- **`SerializerMethodField`** — flag methods that hit the database (N+1 risk in list views).
- **`ViewSet` vs `APIView`** — flag `APIView` used where a `ViewSet` + router would reduce boilerplate.
- **Throttling** — flag APIs missing `DEFAULT_THROTTLE_CLASSES` for anonymous endpoints.
- **`depth` on serializers** — flag `depth > 1`; prefer explicit nested serializers for control.
- **Pagination** — flag list endpoints missing pagination class.
- **`permission_classes = []`** — flag explicitly empty permissions (open endpoint) without comment.

### 🔐 Django Security (extends universal security pillar)
- **`DEBUG = True`** in any non-development settings file — critical, must flag.
- **`SECRET_KEY`** hardcoded in settings — must come from environment variable.
- **`ALLOWED_HOSTS = ['*']`** in production settings — flag.
- **Missing security headers** in production settings:
  ```python
  SECURE_SSL_REDIRECT = True
  SESSION_COOKIE_SECURE = True
  CSRF_COOKIE_SECURE = True
  SECURE_HSTS_SECONDS = 31536000
  X_FRAME_OPTIONS = 'DENY'
  SECURE_CONTENT_TYPE_NOSNIFF = True
  ```
- **`|safe` in templates** — flag any use; verify it's intentional and the value is truly safe.
- **User enumeration** — flag login views that reveal whether an email exists via different error messages.
- **Raw SQL injection** — see ORM section above. Specifically flag PostGIS backend usage with user input and unsanitized geographic query parameters.

### ⚙️ Settings & Configuration
- Flag a single `settings.py` that mixes dev and production config — suggest `settings/base.py`, `settings/dev.py`, `settings/production.py`.
- Flag `INSTALLED_APPS` containing debug tools (`debug_toolbar`, `django_extensions`) in production settings.
- Flag missing `DEFAULT_AUTO_FIELD` (causes warnings in Django 3.2+).
- Flag `DATABASES` with hardcoded credentials — must use `os.environ.get()` or `django-environ`.

### 🧪 Testing
- Flag test files not using `pytest-django` or `TestCase` from `django.test`.
- Flag tests using the production database instead of `@pytest.mark.django_db` or `TransactionTestCase`.
- Flag missing `setUpTestData()` for expensive setup shared across test methods.
- Flag tests that test Django internals (ORM, forms) rather than app behavior.
- Flag missing `assertRaisesMessage` / `assertFormError` where appropriate.

### ⚡ Async (version-gated)
- Flag async views calling sync ORM without `sync_to_async()` (all versions).
- Flag `transaction.atomic()` inside async views without sync wrapping (all versions — transactions are not async-safe).
- Flag missing `await` on `a`-prefixed ORM methods (`await Model.objects.acreate(...)`) — 4.1+.
- Flag async views deployed under WSGI — they work but with performance penalty; suggest ASGI.
- Flag `sync_to_async(decorator)` workarounds for decorators that natively support async (5.0+).

### 🌿 Celery (if present)
- Flag tasks not decorated with `@shared_task` or `@app.task`.
- Flag tasks that are not idempotent (can fail silently if retried).
- Flag missing `bind=True` on tasks that need `self.retry()`.
- Flag database operations in tasks without `transaction.on_commit()` wrapper (risk of operating on uncommitted data).
- Flag hardcoded `CELERY_BROKER_URL` — must come from environment.

### 🧹 Code Style & Tooling
- Flag missing `ruff` configuration (`pyproject.toml` or `ruff.toml`) in new projects.
- Flag `print()` statements left in production code — use `logging`.
- Flag bare `except:` clauses — must be `except Exception` at minimum, with logging.
- Flag imports not organized (stdlib → third-party → local) — `isort` or `ruff` handles this.
- Flag f-strings used in logging calls: `logger.info(f"...")` → use `logger.info("...", extra={...})`.

---

## Unified Output Format

Use the same format as `code-reviewer` (universal). Add a Django context line:

```
🔍 Environment: Python 3.12 | Django 5.2 LTS | DRF 3.15 | ASGI

## Code Review Summary
[... standard universal format ...]

### 🐍 Django-Specific Issues
[Issues found by this overlay, using the same severity/format as universal]
```

---

## Behavior Rules (Django-specific additions)

- **Version first, always** — never apply version-specific rules without confirming the version. Wrong rules on wrong versions produce wrong suggestions.
- **ORM safety over cleverness** — always prefer ORM over raw SQL. When raw SQL is necessary, parameterized queries are non-negotiable.
- **Don't suggest async migrations unless version supports it** — async ORM is only reliable from 4.1+.
- **Settings files are high-risk** — treat any change to `settings/production.py` as security-critical scope.
- **Delegate deep security audits** → `security-auditor` skill if available.
