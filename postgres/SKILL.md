---
name: postgres
description: PostgreSQL best practices, query optimization, schema design, security, operations, and performance tuning. Load when working with Postgres databases.
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# PostgreSQL

## Schema and Data Modeling

| Topic          | Reference                                                  | Use for                                                |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Schema Design  | [references/schema-design.md](references/schema-design.md) | Tables, primary keys, data types, foreign keys, naming |
| JSONB Patterns | [references/json-patterns.md](references/json-patterns.md) | JSONB operators, querying, indexing, best practices    |
| Partitioning   | [references/partitioning.md](references/partitioning.md)   | Range/list partitioning, pg_partman, data retention    |

## Querying and Optimization

| Topic                  | Reference                                                                    | Use for                                                  |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Query Patterns         | [references/query-patterns.md](references/query-patterns.md)                 | SQL anti-patterns, JOINs, pagination, N+1 detection      |
| Indexing               | [references/indexing.md](references/indexing.md)                             | Index types, composite, partial, covering, GIN, BRIN     |
| Index Optimization     | [references/index-optimization.md](references/index-optimization.md)         | Unused/duplicate index detection, bloat, HOT updates     |
| Full-Text Search       | [references/full-text-search.md](references/full-text-search.md)             | tsvector, tsquery, GIN indexing, ranking, search config  |
| Optimization Checklist | [references/optimization-checklist.md](references/optimization-checklist.md) | Pre-optimization audit, cleanup, readiness checks        |

## Internals and Concurrency

| Topic             | Reference                                                          | Use for                                                |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| MVCC and VACUUM   | [references/mvcc-vacuum.md](references/mvcc-vacuum.md)             | Dead tuples, autovacuum tuning, bloat prevention       |
| MVCC Transactions | [references/mvcc-transactions.md](references/mvcc-transactions.md) | Isolation levels, XID wraparound, serialization errors |
| Locking           | [references/locking.md](references/locking.md)                     | Lock types, deadlocks, advisory locks, lock monitoring |

## Operations and Architecture

| Topic                | Reference                                                                  | Use for                                                         |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Process Architecture | [references/process-architecture.md](references/process-architecture.md)   | Multi-process model, connection management, auxiliary processes |
| Memory Architecture  | [references/memory-management-ops.md](references/memory-management-ops.md) | Shared/private memory, OS page cache, OOM prevention            |
| WAL and Checkpoints  | [references/wal-operations.md](references/wal-operations.md)               | WAL internals, checkpoint tuning, durability, crash recovery    |
| Storage Layout       | [references/storage-layout.md](references/storage-layout.md)               | PGDATA structure, TOAST, fillfactor, tablespaces                |
| Replication          | [references/replication.md](references/replication.md)                     | Streaming replication, slots, sync commit, failover             |
| Backup and Recovery  | [references/backup-recovery.md](references/backup-recovery.md)             | pg_dump, pg_basebackup, PITR, WAL archiving                     |

## Configuration and Tuning

| Topic                | Reference                                                                | Use for                                                  |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Configuration Tuning | [references/configuration-tuning.md](references/configuration-tuning.md) | Memory, I/O, planner, parallelism, workload profiles     |
| Connection Pooling   | [references/connection-pooling.md](references/connection-pooling.md)     | PgBouncer setup, pool sizing, pooling modes              |
| Monitoring           | [references/monitoring.md](references/monitoring.md)                     | pg_stat views, logging, pg_stat_statements, host metrics |

## Framework Integration

| Topic              | Reference                                                                | Use for                                                          |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Django Integration | [references/django-integration.md](references/django-integration.md)     | ORM optimization, connection pooling, zero-downtime migrations, contrib.postgres |

## Security and Migrations

| Topic             | Reference                                                          | Use for                                                   |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Security          | [references/security.md](references/security.md)                   | Roles, permissions, RLS, pg_hba.conf, SSL/TLS, audit      |
| Schema Migrations | [references/schema-migrations.md](references/schema-migrations.md) | Zero-downtime DDL, safe migration patterns, backfills     |
| Extensions        | [references/extensions.md](references/extensions.md)               | pg_stat_statements, pgcrypto, PostGIS, pg_repack, pgAudit |
