---
title: Schema Migrations and Zero-Downtime DDL
description: Safe online schema changes, migration strategies, and common pitfalls
tags: postgres, migrations, ddl, zero-downtime, online-schema-change
---

# Schema Migrations and Zero-Downtime DDL

## Lock Classification for DDL

Understanding which DDL operations take which locks is critical for zero-downtime deployments.

### Safe (No Table Rewrite, Brief Lock)

| Operation | Lock Level | Notes |
|-----------|-----------|-------|
| `ADD COLUMN` (nullable, no default or with default PG 11+) | ACCESS EXCLUSIVE (brief) | Fast metadata-only change |
| `DROP COLUMN` | ACCESS EXCLUSIVE (brief) | Marks column as dropped; space reclaimed by VACUUM |
| `CREATE INDEX CONCURRENTLY` | SHARE UPDATE EXCLUSIVE | Does not block writes; slower; may produce INVALID index |
| `SET DEFAULT` / `DROP DEFAULT` | ACCESS EXCLUSIVE (brief) | Metadata-only |
| `ALTER COLUMN TYPE` (some safe casts) | ACCESS EXCLUSIVE (brief) | Safe: `varchar(N)` → `varchar(M)` where M>N, `varchar` → `text` |

### Dangerous (Table Rewrite or Long Lock)

| Operation | Risk | Mitigation |
|-----------|------|------------|
| `ALTER COLUMN TYPE` (most casts) | Full table rewrite + ACCESS EXCLUSIVE | Add new column, backfill, swap |
| `ADD COLUMN ... NOT NULL` (without default, PG <11) | Table rewrite | Add nullable, backfill, add constraint |
| `CREATE INDEX` (non-concurrent) | SHARE lock blocks writes | Always use `CONCURRENTLY` |
| `ADD CONSTRAINT ... FOREIGN KEY` | Scans referenced table with SHARE lock | Use `NOT VALID` then `VALIDATE CONSTRAINT` |
| `CLUSTER` / `VACUUM FULL` | ACCESS EXCLUSIVE for entire duration | Use `pg_repack` instead |

## Safe Migration Patterns

### Adding a NOT NULL Column

```sql
-- Step 1: Add nullable column with default
ALTER TABLE orders ADD COLUMN priority TEXT DEFAULT 'normal';

-- Step 2: Backfill existing rows in batches
UPDATE orders SET priority = 'normal'
  WHERE id BETWEEN 1 AND 100000 AND priority IS NULL;
-- repeat in batches...

-- Step 3: Add NOT NULL constraint
ALTER TABLE orders ALTER COLUMN priority SET NOT NULL;
```

### Adding a Foreign Key

```sql
-- Step 1: Add constraint without validation (brief lock, no scan)
ALTER TABLE orders
  ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id)
  REFERENCES customers(id) NOT VALID;

-- Step 2: Validate separately (ROW SHARE lock on referenced table, allows concurrent writes)
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_fk;
```

### Changing a Column Type

```sql
-- Never do this on a large table:
-- ALTER TABLE users ALTER COLUMN status TYPE integer USING status::integer;

-- Safe approach:
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN status_new INTEGER;

-- Step 2: Backfill in batches
UPDATE users SET status_new = status::integer
  WHERE id BETWEEN 1 AND 100000;

-- Step 3: Application writes to both columns (dual-write)

-- Step 4: Swap (requires brief ACCESS EXCLUSIVE)
ALTER TABLE users RENAME COLUMN status TO status_old;
ALTER TABLE users RENAME COLUMN status_new TO status;

-- Step 5: Drop old column after verification
ALTER TABLE users DROP COLUMN status_old;
```

### Renaming a Table or Column

Renaming takes an ACCESS EXCLUSIVE lock (brief), but breaks application queries instantly. Safe approach:

1. Create a view with the new name pointing to the old table
2. Update application code to use the new name
3. Rename the actual table once all code is migrated
4. Drop the view

### Adding an Index

```sql
-- Always use CONCURRENTLY for production tables
SET statement_timeout = '0';  -- index builds can take time
CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);

-- If it fails, clean up the INVALID index before retrying
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_customer;
CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);
```

## Batch Updates for Backfills

Never update millions of rows in a single transaction — it holds locks, generates WAL, and can trigger OOM.

```sql
-- Batch pattern: update in chunks
DO $$
DECLARE
  batch_size INT := 10000;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE orders SET priority = 'normal'
      WHERE id IN (
        SELECT id FROM orders WHERE priority IS NULL LIMIT batch_size
      );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
    COMMIT;  -- requires PG 11+ procedure, or run batches from app code
    PERFORM pg_sleep(0.1);  -- brief pause to reduce load
  END LOOP;
END $$;
```

For application-level batching, run each batch as a separate transaction from application code.

## Migration Tool Best Practices

Regardless of tool (Flyway, Liquibase, Alembic, golang-migrate, Sqitch, etc.):

- **One DDL operation per migration** — easier to debug and retry
- **Set `lock_timeout`** in each migration to fail fast rather than queue
- **Set `statement_timeout = 0`** for `CREATE INDEX CONCURRENTLY` (it needs unbounded time)
- **Test migrations against production-size data** — a 10ms migration on dev can take 10 minutes on production
- **Make migrations idempotent** where possible (`IF NOT EXISTS`, `IF EXISTS`)
- **Never mix DDL and DML** in the same transaction — DDL acquires table locks that block concurrent DML
- **Version control all migrations** and run them in order
- **Review lock requirements** before deploying any migration to production

## The Expand-Contract Pattern

The safest approach for backwards-incompatible schema changes. Split a dangerous change into three deployments:

1. **Expand** — Add the new schema alongside the old (new column, new table, new index). Application writes to both old and new.
2. **Migrate** — Backfill existing data from old to new. Verify consistency.
3. **Contract** — Remove the old schema once all code uses the new one.

This ensures zero downtime because both old and new application versions work throughout the migration. Tools like **pgroll** automate this pattern by serving multiple schema versions simultaneously through PostgreSQL views.

### Lock Queue Problem

When a DDL statement requires `ACCESS EXCLUSIVE` and waits for existing queries to finish, it **blocks all subsequent operations** from starting — not just the DDL itself. A single long-running SELECT can cause an ACCESS EXCLUSIVE ALTER TABLE to queue, which then blocks all other SELECTs behind it. The entire table appears frozen.

**Prevention:** Always `SET lock_timeout = '5s';` before DDL. If the lock isn't acquired, the statement fails and the queue clears. Retry after the long-running query finishes.

## Rollback Strategy

- Prefer forward-fix over rollback — add a new migration that undoes the change
- `DROP COLUMN` is safe and fast (metadata-only)
- Dropping a constraint is fast; re-adding it may require a scan
- Dropped indexes must be rebuilt with `CREATE INDEX CONCURRENTLY`
- **Always confirm destructive rollbacks with a human** before executing
