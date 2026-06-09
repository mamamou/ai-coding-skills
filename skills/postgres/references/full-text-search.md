---
title: Full-Text Search
description: tsvector, tsquery, GIN indexing, search configuration, ranking, and optimization
tags: postgres, full-text-search, tsvector, tsquery, gin, ranking
---

# Full-Text Search

PostgreSQL provides built-in full-text search that handles stemming, ranking, and multiple languages without external tools.

## Core Concepts

- **`tsvector`** — A sorted list of normalized lexemes (words reduced to their root form) with position information
- **`tsquery`** — A search query with boolean operators (`&` AND, `|` OR, `!` NOT, `<->` FOLLOWED BY)
- **`@@`** — The match operator: `tsvector @@ tsquery`

```sql
-- Basic usage
SELECT to_tsvector('english', 'The quick brown foxes jumped')
  @@ to_tsquery('english', 'fox & jump');  -- true (stemmed: fox, jump)
```

## Setting Up Full-Text Search

### Option 1: Computed Column (Recommended)

Store a pre-computed `tsvector` column for best query performance.

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);
```

### Option 2: Trigger-Based (PG <12 or Custom Logic)

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector;

CREATE FUNCTION articles_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE
  ON articles FOR EACH ROW EXECUTE FUNCTION articles_search_trigger();

CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);
```

### Option 3: Expression Index (No Extra Column)

Simpler but slower for complex expressions — the tsvector is recomputed on every query.

```sql
CREATE INDEX articles_search_idx ON articles
  USING GIN (to_tsvector('english', title || ' ' || body));

-- Query must match the expression exactly
SELECT * FROM articles
WHERE to_tsvector('english', title || ' ' || body) @@ to_tsquery('english', 'search terms');
```

## Search Queries

### Basic Search

```sql
SELECT id, title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'database & performance') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20;
```

### Phrase Search

```sql
-- Words must be adjacent (FOLLOWED BY operator)
SELECT * FROM articles
WHERE search_vector @@ to_tsquery('english', 'full <-> text <-> search');

-- Words within N positions
SELECT * FROM articles
WHERE search_vector @@ to_tsquery('english', 'database <2> tuning');
```

### Prefix Search

```sql
-- Match words starting with "optim" (optimize, optimization, etc.)
SELECT * FROM articles
WHERE search_vector @@ to_tsquery('english', 'optim:*');
```

### User Input (websearch_to_tsquery)

Converts natural search input to tsquery safely — no need to parse boolean operators.

```sql
-- PG 11+: handles user input like a search engine
SELECT * FROM articles
WHERE search_vector @@ websearch_to_tsquery('english', 'postgres full text search -mysql');
-- Translates to: 'postgr' & 'full' & 'text' & 'search' & !'mysql'
```

**Always use `websearch_to_tsquery()` or `plainto_tsquery()` for user input** — `to_tsquery()` requires valid boolean syntax and will error on raw user input.

## Weights and Ranking

### Weights

Assign importance to different fields with `setweight()`:

| Weight | Typical Use | Default Multiplier |
|--------|------------|-------------------|
| A | Title, name | 1.0 |
| B | Abstract, summary | 0.4 |
| C | Body text | 0.2 |
| D | Metadata, tags | 0.1 |

### Ranking Functions

```sql
-- ts_rank: frequency-based ranking
SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'postgres') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- ts_rank_cd: cover density ranking (rewards proximity of matching terms)
SELECT title, ts_rank_cd(search_vector, query) AS rank
FROM articles, to_tsquery('english', 'full <-> text') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- Custom weights: {D, C, B, A}
SELECT title, ts_rank('{0.1, 0.2, 0.4, 1.0}', search_vector, query) AS rank
FROM articles, to_tsquery('english', 'postgres') AS query
WHERE search_vector @@ query
ORDER BY rank DESC;
```

## Highlighting

```sql
SELECT ts_headline('english', body, to_tsquery('english', 'postgres'),
  'StartSel=<b>, StopSel=</b>, MaxWords=35, MinWords=15, MaxFragments=3')
FROM articles
WHERE search_vector @@ to_tsquery('english', 'postgres');
```

`ts_headline` is expensive — apply it only to the already-filtered result set, not in the WHERE clause.

## Search Configuration

### Text Search Configurations

```sql
-- List available configurations
SELECT cfgname FROM pg_ts_config;

-- Common: 'english', 'simple', 'french', 'german', 'spanish'
-- 'simple' does no stemming — useful for identifiers, codes, exact matching
```

### Custom Dictionaries

```sql
-- Synonym dictionary for domain-specific terms
CREATE TEXT SEARCH DICTIONARY my_synonyms (
  TEMPLATE = synonym,
  SYNONYMS = my_synonyms  -- file: $SHAREDIR/tsearch_data/my_synonyms.syn
);
```

### Unaccent (Accent-Insensitive Search)

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Use in tsvector generation for accent-insensitive matching
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', unaccent(coalesce(title, '')))
  ) STORED;
```

## Combining with pg_trgm

For fuzzy/typo-tolerant search, combine full-text search with `pg_trgm`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text for relevance, trigram for fuzzy matching
SELECT title,
  ts_rank(search_vector, query) AS fts_rank,
  similarity(title, 'postgre') AS trgm_sim
FROM articles, websearch_to_tsquery('english', 'postgre') AS query
WHERE search_vector @@ query OR title % 'postgre'
ORDER BY fts_rank + trgm_sim DESC;
```

## Performance Best Practices

- **Always use a stored `tsvector` column + GIN index** for tables with >10K rows
- **GIN vs GiST:** GIN is faster for reads (exact match); GiST is faster for updates and supports distance operators. Use GIN for most search workloads
- **`ts_headline` is expensive** — run it only on final result rows, not during filtering
- Use `websearch_to_tsquery()` for user-facing search — it's safe and intuitive
- Set the text search configuration explicitly (`'english'`) rather than relying on `default_text_search_config` — avoids surprises across environments
- For multi-language content, store the language per row and use it dynamically
- GIN indexes on `tsvector` columns support fast `@@` matching but not ranking — ranking is always computed at query time
- Consider `rum` index extension for combined search + sort by rank (avoids the separate ranking step)
