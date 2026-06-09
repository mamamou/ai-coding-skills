---
title: JSONB Patterns
description: JSONB querying, indexing, operators, and best practices
tags: postgres, jsonb, json, indexing, queries, document-store
---

# JSONB Patterns

## When to Use JSONB

- Flexible/evolving schemas (user preferences, metadata, feature flags)
- Event payloads, API responses, audit data
- Document-like data where structure varies across rows

**When NOT to use:** structured data that you query, filter, or join on regularly — use normal columns instead.

## Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `->` | Get JSON object by key (returns JSON) | `data -> 'name'` |
| `->>` | Get JSON value by key (returns text) | `data ->> 'name'` |
| `#>` | Get nested JSON by path | `data #> '{address,city}'` |
| `#>>` | Get nested text by path | `data #>> '{address,city}'` |
| `@>` | Contains (left contains right) | `data @> '{"status":"active"}'` |
| `<@` | Contained by | `'{"a":1}' <@ data` |
| `?` | Key exists | `data ? 'email'` |
| `?|` | Any key exists | `data ?| array['email','phone']` |
| `?&` | All keys exist | `data ?& array['email','phone']` |
| `||` | Concatenate/merge JSONB | `data || '{"new_key":"val"}'` |
| `-` | Remove key | `data - 'old_key'` |
| `#-` | Remove nested key by path | `data #- '{address,zip}'` |

## Common Query Patterns

### Filtering by JSONB Values

```sql
-- Exact match on nested value
SELECT * FROM events WHERE payload @> '{"type":"click","source":"web"}';

-- Text comparison (extract then compare)
SELECT * FROM events WHERE payload ->> 'type' = 'click';

-- Numeric comparison (cast extracted value)
SELECT * FROM events WHERE (payload ->> 'score')::integer > 90;

-- Nested field access
SELECT * FROM users WHERE profile #>> '{address,country}' = 'US';
```

### Aggregating JSONB Data

```sql
-- Expand array elements
SELECT id, jsonb_array_elements(data -> 'tags') AS tag FROM articles;

-- Expand object to key-value pairs
SELECT id, key, value FROM configs, jsonb_each(settings) AS kv(key, value);

-- Build JSONB from query results
SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM users;
```

### Updating JSONB

```sql
-- Set/update a key
UPDATE users SET profile = jsonb_set(profile, '{theme}', '"dark"');

-- Set nested key (create intermediate objects)
UPDATE users SET profile = jsonb_set(profile, '{prefs,lang}', '"en"', true);

-- Remove a key
UPDATE users SET profile = profile - 'deprecated_field';

-- Merge objects
UPDATE users SET profile = profile || '{"verified": true}';
```

## Indexing JSONB

### GIN Index (Most Common)

```sql
-- Default GIN: supports @>, ?, ?|, ?&
CREATE INDEX events_payload_gin ON events USING GIN (payload);

-- Query that uses GIN index
SELECT * FROM events WHERE payload @> '{"type":"click"}';
```

### GIN with jsonb_path_ops

```sql
-- Smaller index, faster @> lookups, but ONLY supports @> operator
CREATE INDEX events_payload_pathops ON events USING GIN (payload jsonb_path_ops);
```

Use `jsonb_path_ops` when you only need `@>` containment queries — it's ~2–3x smaller and faster than default GIN.

### Expression Index (Specific Keys)

```sql
-- Index a specific extracted value for equality/range queries
CREATE INDEX events_type_idx ON events ((payload ->> 'type'));

-- Supports:
SELECT * FROM events WHERE payload ->> 'type' = 'click';

-- For numeric range queries on extracted values:
CREATE INDEX events_score_idx ON events (((payload ->> 'score')::integer));
```

Expression indexes are smaller and faster than GIN when you query specific known keys.

## Index Selection Guide

| Query Pattern | Index Type |
|--------------|-----------|
| `@>` containment | GIN (default or `jsonb_path_ops`) |
| `?`, `?|`, `?&` key existence | GIN (default only) |
| `payload ->> 'key' = 'value'` | Expression B-tree on `(payload ->> 'key')` |
| `(payload ->> 'key')::int > N` | Expression B-tree on `((payload ->> 'key')::int)` |
| Full-text search on JSONB values | GIN with `to_tsvector` expression |

## Best Practices

- Prefer `JSONB` over `JSON` — `JSONB` is parsed on write, supports indexing, and is faster for reads
- Don't store the entire row as JSONB — extract frequently queried fields as regular columns
- **Promote hot keys to typed columns** when access patterns stabilize — a regular column with a B-tree index outperforms JSONB extraction for frequently queried fields
- Use `@>` containment with GIN indexes instead of `->>` extraction for filtering when possible
- Move JSON transformations out of WHERE clauses to enable better index usage (20–35% improvement in some benchmarks)
- Keep JSONB documents reasonably small — large documents (>8KB) trigger TOAST, which adds overhead
- Validate JSONB structure with CHECK constraints or application-level validation
- Use `jsonb_strip_nulls()` when building JSONB to avoid storing null keys
- **Audit query patterns with `pg_stat_statements` before adding GIN indexes** — GIN indexes have significant write overhead; don't add them "just in case" on write-heavy tables
- Monitor GIN index size — they can grow large on high-cardinality data; consider `jsonb_path_ops`
- Frequent large JSONB updates cause index bloat — consider partial updates with `jsonb_set()` instead of replacing entire documents

## JSON vs JSONB

| Feature | JSON | JSONB |
|---------|------|-------|
| Storage | Stores exact text (including whitespace) | Binary, parsed on write |
| Duplicate keys | Preserved | Last value wins |
| Key ordering | Preserved | Not preserved |
| Indexing | Not supported | GIN, expression indexes |
| Performance | Faster writes, slower reads | Slower writes, faster reads |

Use `JSON` only when you need to preserve exact formatting (rare). Default to `JSONB`.
