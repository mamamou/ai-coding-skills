---
title: Common PostgreSQL Extensions
description: Essential and widely-used PostgreSQL extensions for monitoring, indexing, data types, and operations
tags: postgres, extensions, pg_stat_statements, postgis, pg_trgm, pgcrypto
---

# Common PostgreSQL Extensions

## Essential Extensions

### pg_stat_statements (Monitoring)

Tracks execution statistics for all SQL statements. **Install on every production database.**

```sql
-- postgresql.conf: shared_preload_libraries = 'pg_stat_statements'  (requires restart)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top queries by total time
SELECT query, calls, total_exec_time, mean_exec_time,
  rows, 100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_pct
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;
```

### pgcrypto (Cryptography)

Hashing, encryption, and random data generation.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generate UUIDs (alternative to uuid-ossp)
SELECT gen_random_uuid();

-- Hash passwords (use in application layer instead when possible)
SELECT crypt('password', gen_salt('bf'));
```

### pg_trgm (Trigram Similarity)

Fuzzy text matching, similarity search, and LIKE/ILIKE index acceleration.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index for LIKE/ILIKE queries
CREATE INDEX users_name_trgm ON users USING GIN (name gin_trgm_ops);

-- Fuzzy search
SELECT name, similarity(name, 'John') AS sim
FROM users WHERE name % 'John' ORDER BY sim DESC;

-- Accelerated LIKE
SELECT * FROM users WHERE name ILIKE '%smith%';  -- uses GIN trgm index
```

## Data Type Extensions

### uuid-ossp (UUID Generation)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SELECT uuid_generate_v4();     -- random UUID
SELECT uuid_generate_v7();     -- time-ordered UUID (PG 17+; also available via gen_random_uuid() workarounds)
```

**Note:** PG 13+ includes `gen_random_uuid()` without any extension. Use `uuid-ossp` only if you need specific UUID versions.

### hstore (Key-Value Pairs)

Lightweight key-value store. Consider JSONB for new designs — it's more capable and better supported.

```sql
CREATE EXTENSION IF NOT EXISTS hstore;
SELECT 'a=>1, b=>2'::hstore -> 'a';  -- returns '1'
```

### citext (Case-Insensitive Text)

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE users (
  email CITEXT UNIQUE  -- case-insensitive uniqueness
);
```

Alternative: use `LOWER()` expression index on `TEXT` columns for more control.

## Operational Extensions

### pgstattuple (Tuple-Level Statistics)

Detect table and index bloat.

```sql
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- Table bloat
SELECT dead_tuple_percent, free_percent FROM pgstattuple('my_table');

-- Index bloat (leaf density)
SELECT avg_leaf_density FROM pgstatindex('my_index');
-- Below 70% = significant bloat; healthy = 80-90%+
```

### pg_repack (Online Table Rewrite)

Repacks tables and indexes without ACCESS EXCLUSIVE lock for the full duration. Use instead of `VACUUM FULL` or `CLUSTER`.

```sql
-- Run from command line (not SQL)
-- pg_repack -d mydb -t my_table
```

Requires: primary key on the table, ~2x disk space for the table being repacked.

### pg_partman (Partition Management)

Automates partition creation, maintenance, and retention for time-based or serial-based partitioning.

```sql
CREATE EXTENSION IF NOT EXISTS pg_partman;

SELECT partman.create_parent(
  p_parent_table := 'public.events',
  p_control := 'created_at',
  p_type := 'native',
  p_interval := 'monthly'
);
```

### pgAudit (Audit Logging)

Compliance-grade audit logging for SOC2, HIPAA, PCI-DSS.

```sql
-- postgresql.conf: shared_preload_libraries = 'pgaudit'  (requires restart)
CREATE EXTENSION IF NOT EXISTS pgaudit;
SET pgaudit.log = 'write, ddl';
```

## Search and Analytics Extensions

### PostGIS (Geospatial)

Industry-standard geospatial extension for location data, spatial queries, and geographic analysis.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE places (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326)
);
CREATE INDEX places_location_gist ON places USING GIST (location);

-- Find places within 5km
SELECT name FROM places
WHERE ST_DWithin(location, ST_MakePoint(-73.99, 40.73)::geography, 5000);
```

### pg_vector (Vector Similarity)

Vector storage and similarity search for AI/ML embeddings.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  embedding vector(1536)
);
CREATE INDEX items_embedding_idx ON items USING ivfflat (embedding vector_cosine_ops);

-- Nearest neighbor search
SELECT id FROM items ORDER BY embedding <=> '[0.1, 0.2, ...]' LIMIT 10;
```

## Extension Management

```sql
-- List installed extensions
SELECT extname, extversion FROM pg_extension;

-- List available extensions
SELECT name, default_version, comment FROM pg_available_extensions ORDER BY name;

-- Upgrade extension
ALTER EXTENSION pg_stat_statements UPDATE;

-- Drop extension
DROP EXTENSION IF EXISTS hstore;
```

### pg_stat_io (PG 16+, Built-in)

Provides detailed I/O statistics by backend type, object type, and context. Replaces the need to infer I/O behavior from `pg_stat_bgwriter`.

```sql
-- Backend direct writes (indicates shared_buffers pressure)
SELECT backend_type, object, reads, writes, extends
FROM pg_stat_io WHERE writes > 0 ORDER BY writes DESC;
```

Key metric: high `writes` for `client backend` means backends are writing dirty pages directly — increase `shared_buffers` or tune bgwriter.

### pg_squeeze (Online Table Compaction)

Alternative to `pg_repack` that uses logical decoding instead of triggers. Lower overhead on write-heavy tables.

```sql
-- postgresql.conf: shared_preload_libraries = 'pg_squeeze'  (requires restart)
CREATE EXTENSION pg_squeeze;
-- Schedule automatic squeezing
SELECT squeeze.start_worker();
```

### pgTAP (Database Unit Testing)

Write unit tests for database functions, schemas, and constraints.

```sql
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Example test
SELECT plan(2);
SELECT has_table('users');
SELECT has_column('users', 'email');
SELECT * FROM finish();
```

Integrate with CI/CD pipelines using `pg_prove` command-line runner.

### Guidelines

- Enable `pg_stat_statements` on every database — it's low-overhead and invaluable
- Extensions that require `shared_preload_libraries` need a server restart
- Test extensions in staging before production — some add overhead or change planner behavior
- Keep extensions updated during major version upgrades
- Check extension compatibility with your PostgreSQL version before upgrading
