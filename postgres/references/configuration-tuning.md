---
title: Configuration Tuning
description: PostgreSQL configuration parameters for memory, I/O, connections, planner, and workload-specific tuning
tags: postgres, configuration, tuning, performance, shared_buffers, work_mem
---

# Configuration Tuning

## Parameter Categories

| Category | Requires Restart | Example Parameters |
|----------|-----------------|-------------------|
| **Postmaster** | Yes (full restart) | `shared_buffers`, `max_connections`, `shared_preload_libraries`, `wal_level` |
| **SIGHUP** | No (reload only) | `work_mem`, `effective_cache_size`, `checkpoint_timeout`, `max_wal_size` |
| **User/Session** | No (per session) | `work_mem`, `statement_timeout`, `search_path` |

Reload config: `SELECT pg_reload_conf();` or `pg_ctl reload`.

## Memory Parameters

### shared_buffers

Main data cache shared across all processes.

| RAM | Recommended | Notes |
|-----|-------------|-------|
| ≤1 GB | 25% of RAM | Small instances |
| 1–64 GB | 25% of RAM | General starting point |
| >64 GB | 16–32 GB | Diminishing returns; leaves more for OS page cache |

Requires restart. Too large → slower startup, heavier checkpoints, less OS cache.

### huge_pages

```
huge_pages = try                          # Use huge pages if available (reduces TLB misses)
```

Significant benefit for systems with >8GB `shared_buffers`. Requires OS configuration (`vm.nr_hugepages`). Use `try` (not `on`) to avoid startup failure if huge pages are unavailable. Most impactful for OLAP and large-memory systems.

### work_mem

Per-operation memory for sorts, hashes, and joins.

| Workload | Recommended |
|----------|-------------|
| OLTP (many connections, simple queries) | 4–16 MB |
| Mixed | 16–64 MB |
| OLAP (few connections, complex queries) | 64–256 MB |

**Danger:** `work_mem × operations × parallel_workers × connections` can exhaust RAM. Start low, increase per-session for heavy queries: `SET work_mem = '256MB';`

### maintenance_work_mem

Used by VACUUM, CREATE INDEX, ALTER TABLE ADD FK.

| RAM | Recommended |
|-----|-------------|
| ≤8 GB | 512 MB |
| 8–64 GB | 1–2 GB |
| >64 GB | 2–4 GB |

Cap autovacuum separately with `autovacuum_work_mem` to prevent `autovacuum_max_workers × maintenance_work_mem` spikes.

### effective_cache_size

**Not allocated** — planner hint only. Tells the planner how much memory is available for caching (shared_buffers + OS page cache).

Set to 50–75% of total RAM.

## Connection Parameters

```
max_connections = 100                     # Requires restart; keep low with pooling
superuser_reserved_connections = 3        # Emergency admin access
```

**Rule:** Use connection pooling instead of raising `max_connections`. Each connection = ~5–10MB base + query memory.

## WAL and Checkpoint Parameters

```
wal_level = replica                       # Default; needed for replication/PITR
max_wal_size = 2GB                        # Increase if "checkpoints occurring too frequently"
min_wal_size = 256MB                      # Minimum WAL disk reservation
checkpoint_timeout = 5min                 # Default; increase for write-heavy (15–30min)
checkpoint_completion_target = 0.9        # Spread I/O over 90% of interval
wal_compression = lz4                     # PG 15+; reduces WAL size (pglz before PG 15)
```

**Target:** >90% of checkpoints should be time-based (`num_timed` in `pg_stat_checkpointer`).

## Planner Parameters

```
random_page_cost = 1.1                    # SSD storage (default 4.0 assumes spinning disk)
effective_io_concurrency = 200            # SSD (default 1; Linux/FreeBSD only)
seq_page_cost = 1.0                       # Default; usually fine
```

For correlated columns: `CREATE STATISTICS (dependencies, ndistinct, mcv) ON col1, col2 FROM table;` then `ANALYZE`.

For skewed distributions: `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000;` (default 100).

## Parallelism

```
max_worker_processes = 8                  # Total background workers (requires restart)
max_parallel_workers_per_gather = 2       # Workers per query node
max_parallel_workers = 8                  # Total parallel query workers
max_parallel_maintenance_workers = 2      # For CREATE INDEX, VACUUM
parallel_leader_participation = on        # Leader also executes (default)
min_parallel_table_scan_size = 8MB        # Minimum table size for parallel scan
```

**Rule:** Reduce `max_parallel_workers_per_gather` in high-concurrency OLTP systems — parallelism helps few large queries but hurts many small ones competing for CPU.

## Timeout Parameters

```
statement_timeout = 30s                   # Kill runaway queries (0 = disabled; set per-session for analytics)
idle_in_transaction_session_timeout = 60s # Kill abandoned transactions holding locks
lock_timeout = 5s                         # Fail fast on DDL waiting for locks
```

## Logging Parameters

```
log_min_duration_statement = 1000         # Log queries >1s (ms); OLTP: 1000-3000, analytics: 30000-60000
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0                        # Log all temp file usage (spills to disk)
log_line_prefix = '%m [%p] %u@%d '        # timestamp, pid, user, database
```

## Autovacuum Parameters

```
autovacuum_vacuum_scale_factor = 0.2      # Default; lower to 0.01-0.05 for large tables (per-table)
autovacuum_vacuum_cost_delay = 2          # ms; set to 0 on fast storage
autovacuum_vacuum_cost_limit = 200        # Raise to 1000-2000 on fast storage
autovacuum_max_workers = 3                # Default; increase for many tables
```

Always tune per-table first (`ALTER TABLE ... SET (autovacuum_vacuum_scale_factor = 0.02)`) before changing global defaults.

## Workload Profiles

### OLTP (Web/API)

```
shared_buffers = 25% RAM
work_mem = 4-16MB
max_connections = 100 (with pooling)
max_parallel_workers_per_gather = 0-2
random_page_cost = 1.1 (SSD)
statement_timeout = 30s
effective_cache_size = 75% RAM
```

### OLAP (Analytics/Reporting)

```
shared_buffers = 25% RAM
work_mem = 128-512MB
max_connections = 20-50
max_parallel_workers_per_gather = 4-8
random_page_cost = 1.1 (SSD)
statement_timeout = 0 (or very high)
effective_cache_size = 75% RAM
huge_pages = try
```

### Mixed (OLTP + Reporting)

Use OLTP settings globally. Set higher `work_mem` and parallelism per-session for analytics queries. Route reporting to a read replica when possible.

## Configuration Management

- Use `ALTER SYSTEM SET parameter = value;` to persist changes to `postgresql.auto.conf` — survives restarts without editing files manually
- Track `postgresql.conf` and `postgresql.auto.conf` in version control for audit trail
- `ALTER SYSTEM RESET parameter;` removes an override
- Always test configuration changes in staging with production-representative data and load before applying to production

## Tuning Process

1. **Start with defaults** — PostgreSQL defaults are conservative but safe
2. **Set `shared_buffers`** to 25% RAM and `effective_cache_size` to 75% RAM
3. **Enable `pg_stat_statements`** and collect a baseline
4. **Tune planner** (`random_page_cost`, `effective_io_concurrency`) for your storage
5. **Adjust `work_mem`** based on temp file spills (`temp_blks_written` in pg_stat_statements)
6. **Tune checkpoints** if "checkpoints occurring too frequently" appears in logs
7. **Tune autovacuum** per-table for high-write tables
8. **Monitor and iterate** — never change multiple parameters at once
