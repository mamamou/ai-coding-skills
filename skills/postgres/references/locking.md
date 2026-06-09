---
title: Locking and Deadlocks
description: Lock types, lock monitoring, deadlock detection, advisory locks, and lock-safe DDL patterns
tags: postgres, locks, deadlocks, advisory-locks, concurrency, ddl
---

# Locking and Deadlocks

## Lock Types

PostgreSQL uses multiple lock levels. Higher-numbered locks conflict with more operations.

| Lock Mode | Acquired By | Conflicts With |
|-----------|------------|----------------|
| `ACCESS SHARE` | SELECT | ACCESS EXCLUSIVE |
| `ROW SHARE` | SELECT FOR UPDATE/SHARE | EXCLUSIVE, ACCESS EXCLUSIVE |
| `ROW EXCLUSIVE` | INSERT, UPDATE, DELETE | SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| `SHARE` | CREATE INDEX (non-concurrent) | ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| `SHARE ROW EXCLUSIVE` | CREATE TRIGGER, some ALTER TABLE | ROW EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| `EXCLUSIVE` | REFRESH MATERIALIZED VIEW CONCURRENTLY | ROW SHARE, ROW EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| `ACCESS EXCLUSIVE` | DROP, TRUNCATE, ALTER TABLE, VACUUM FULL, REINDEX (non-concurrent) | **All locks** — blocks everything including SELECT |

**Key insight:** Readers never block writers and writers never block readers for row-level operations (MVCC). Table-level DDL locks are where blocking occurs.

## Lock Monitoring

### Find Blocked Queries

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  now() - blocked.query_start AS blocked_duration,
  blocker.pid AS blocker_pid,
  blocker.query AS blocker_query,
  blocker.state AS blocker_state
FROM pg_stat_activity blocked
JOIN unnest(pg_blocking_pids(blocked.pid)) AS blocker_pid ON true
JOIN pg_stat_activity blocker ON blocker.pid = blocker_pid
WHERE blocked.wait_event_type = 'Lock';
```

### View All Locks

```sql
SELECT
  l.locktype, l.relation::regclass, l.mode, l.granted,
  a.pid, a.query, a.state, now() - a.query_start AS duration
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.relation IS NOT NULL
ORDER BY l.relation, l.mode;
```

## Deadlocks

PostgreSQL automatically detects deadlocks (configurable via `deadlock_timeout`, default 1s) and aborts one of the conflicting transactions. The victim gets: `ERROR: deadlock detected`.

### Prevention

- Access tables in a consistent order across all transactions
- Keep transactions short — acquire locks as late as possible, commit early
- Use `SELECT ... FOR UPDATE NOWAIT` or `SKIP LOCKED` when appropriate
- Avoid mixing DDL and DML in the same transaction

### Monitoring

```sql
-- Check for recent deadlocks
SELECT datname, deadlocks FROM pg_stat_database WHERE deadlocks > 0;
```

Enable `log_lock_waits = on` and set `deadlock_timeout = 1s` to log lock waits in server logs.

## Advisory Locks

Application-level locks managed by PostgreSQL but not tied to any table or row.

```sql
-- Session-level (held until explicit release or session end)
SELECT pg_advisory_lock(12345);        -- blocks until acquired
SELECT pg_advisory_unlock(12345);

-- Transaction-level (released at COMMIT/ROLLBACK)
SELECT pg_advisory_xact_lock(12345);

-- Non-blocking variants
SELECT pg_try_advisory_lock(12345);    -- returns true/false immediately
```

### Use Cases

- Preventing duplicate cron/batch job execution
- Application-level mutex for distributed coordination
- Rate limiting or resource reservation

### Rules

- Use consistent key conventions (e.g., hash of table name + row ID)
- Session-level locks must be explicitly released — leaks block other processes
- Not available through PgBouncer in transaction pooling mode
- Two-key variants available: `pg_advisory_lock(key1, key2)` with two `integer` keys

## Lock-Safe DDL Patterns

### Adding Columns

```sql
-- Safe: does NOT rewrite table (PG 11+, for volatile defaults PG uses stored default)
ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';

-- Dangerous: adding NOT NULL without default on existing column rewrites table
-- Safe approach: add column, backfill, then add constraint
ALTER TABLE users ADD COLUMN score INTEGER;
-- backfill in batches...
ALTER TABLE users ALTER COLUMN score SET NOT NULL;
```

### Adding Indexes

```sql
-- Blocks writes for duration of build:
CREATE INDEX users_email_idx ON users (email);

-- Non-blocking (slower, may fail — check for INVALID state):
CREATE INDEX CONCURRENTLY users_email_idx ON users (email);
```

### Setting Lock Timeouts

```sql
-- Prevent DDL from waiting indefinitely for locks
SET lock_timeout = '5s';
ALTER TABLE users ADD COLUMN new_col TEXT;
RESET lock_timeout;
```

If the lock isn't acquired within the timeout, the statement fails rather than blocking other queries in the lock queue.
