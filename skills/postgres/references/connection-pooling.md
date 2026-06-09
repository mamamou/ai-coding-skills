---
title: Connection Pooling
description: PgBouncer and Pgpool-II setup, pool sizing, pooling modes, and troubleshooting
tags: postgres, pgbouncer, pgpool, connection-pooling, performance
---

# Connection Pooling

## Why Pool

Each PostgreSQL connection = one OS process (fork overhead, context switching, ~5–10MB base memory). Without pooling, 1000 app connections = 1000 backend processes. Connection pooling multiplexes many application connections to fewer database backends.

**Rule: implement pooling before raising `max_connections`.**

## PgBouncer (Recommended)

Lightweight, single-threaded proxy. Handles thousands of client connections with minimal overhead.

### Pooling Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Transaction** (recommended) | Connection returned to pool after each transaction | OLTP web apps, APIs |
| **Session** | Connection held until client disconnects | Apps needing session features (LISTEN/NOTIFY, temp tables) |
| **Statement** | Connection returned after each statement | Simple autocommit workloads only |

### Transaction Mode Limitations

These features are **unavailable** in transaction pooling mode:

- Prepared statements that persist across transactions (use `DEALLOCATE ALL` or protocol-level prepared statements in PG 17+)
- Temporary tables
- `LISTEN`/`NOTIFY`
- Session-level advisory locks
- `SET` commands persisting beyond a transaction
- `DECLARE ... CURSOR` outside a transaction block

### Key Configuration

```ini
[databases]
mydb = host=127.0.0.1 port=5432 dbname=mydb

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
pool_mode = transaction
default_pool_size = 25
max_client_conn = 1000
max_db_connections = 50
server_idle_timeout = 300
server_lifetime = 3600
```

### Pool Sizing

**`default_pool_size`** — server connections per user/database pair.

| Scenario | Recommended |
|----------|-------------|
| Single app, single DB | 25–50 |
| Multiple apps/users/DBs | 10–25 per pair |

**Multiplication:** 2 users × 3 databases = 6 pools × `default_pool_size`.

**`max_db_connections`** — hard cap on total backend connections per database across all pools. Set to leave headroom for direct admin connections.

**Formula:** `(number_of_pools × default_pool_size) < max_connections − 15` (reserve system slots). More conservatively: `max_connections ≥ (all PgBouncer pools) + direct connections + 20% buffer`

### Monitoring PgBouncer

```bash
# Connect to PgBouncer admin console
psql -p 6432 -U pgbouncer pgbouncer

# Useful admin commands
SHOW POOLS;       -- active/waiting/server connections per pool
SHOW CLIENTS;     -- client connection details
SHOW SERVERS;     -- backend connection details
SHOW STATS;       -- request/query counts, bytes, timing
SHOW CONFIG;      -- current configuration
```

Watch for: `cl_waiting > 0` (clients waiting for a backend), `sv_active` near `default_pool_size` (pool saturation).

### Prepared Statement Support

Newer PgBouncer versions support prepared statements in transaction pooling mode. Configure `max_prepared_statements` to a value larger than your application's commonly used prepared statements. Add `ignore_startup_parameters = extra_float_digits` for compatibility with many client libraries and ORMs.

## Alternative Poolers

| Pooler | Language | Key Differentiator |
|--------|----------|-------------------|
| **PgBouncer** | C | Lightweight, battle-tested, most widely deployed |
| **Pgpool-II** | C | Built-in load balancing, read/write splitting, query routing to replicas |
| **PgCat** | Rust | Protocol-aware, sharding support, multi-tenant, modern alternative |
| **Supavisor** | Elixir | Designed for multi-tenant, high-connection-count environments |

Use PgBouncer as the default choice. Consider alternatives when you need built-in read/write splitting (Pgpool-II), sharding (PgCat), or massive multi-tenant connection counts (Supavisor).

## General Pool Sizing Rules

1. Start with `pool_size = CPU cores × 2` on the database server as a baseline
2. Measure actual concurrent active queries under load, not total app connections
3. Account for `work_mem` multiplication: each backend can use `work_mem × operations × parallel_workers`
4. Reserve 10–20% of `max_connections` for direct admin/maintenance access
5. Monitor and adjust — pool sizing is workload-dependent

## Common Problems

| Problem | Fix |
|---------|-----|
| `too many clients already` | Implement/tune pooling; check for connection leaks |
| Clients waiting (pool exhaustion) | Increase pool size or optimize slow queries holding connections |
| `prepared statement does not exist` | Switch to transaction-safe prepared statements or use session mode |
| High backend memory | Reduce pool size; lower `work_mem`; add `statement_timeout` |

## Direct Connections (Bypass Pooler)

Use direct connections (port 5432) for:

- Schema changes (DDL)
- `pg_dump` / `pg_restore`
- Long-running analytics or batch jobs
- Sessions needing temp tables, advisory locks, or `LISTEN`/`NOTIFY`
- Administrative maintenance (VACUUM, REINDEX)
