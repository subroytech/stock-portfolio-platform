# Database Schema

Live schema on CockroachDB Cloud, database `stockPortfolioAnalysis`. Source of truth is
`backend/src/db/migrations/*.sql`, applied via `npm run migrate` (see `migrate.js`); this
doc mirrors what CockroachDB actually built (via `SHOW CREATE TABLE`), which differs
slightly from the raw SQL — notably `SERIAL` compiles to `INT8 DEFAULT unique_rowid()`,
not a true incrementing sequence.

**How to regenerate this doc / check live state yourself:** run `SHOW CREATE TABLE <name>;`
in the CockroachDB console's SQL Shell, or `SHOW TABLES FROM "stockPortfolioAnalysis".public;`
to list all tables. Don't trust the console's Databases *overview* page — it caches table
counts and can show 0 even when tables exist (see `SHOW TABLES`/SQL Shell instead).

## Entity relationships

```
users (1) ──< portfolios (many)
                  │
                  ├──< holdings (many)
                  ├──< cash_positions (1, unique per portfolio)
                  └──< uploads (many)

m_index_master (1) ──< m_index_constituent (many)

m_tickers  — standalone reference table, not FK'd from anywhere
```

All child tables cascade-delete when their parent is deleted (`ON DELETE CASCADE`).

`m_tickers` and `m_index_constituent.symbol` are intentionally **not** foreign-keyed to
each other or to `holdings.symbol` — they're reference/lookup data, and a symbol appearing
in a portfolio or an index shouldn't be blocked by missing metadata coverage.

The `m_` prefix marks reference/master-data tables, distinguishing them from transactional
tables (`users`, `portfolios`, `holdings`, ...). Renamed from bare `tickers`/`index_master`/
`index_constituent` on 2026-07-10 (migration `009_rename_master_tables.sql`) — internal
constraint/index names (e.g. `index_constituent_pkey`) were **not** renamed by CockroachDB's
`ALTER TABLE ... RENAME TO`, so they still carry the old, unprefixed table name. That's
expected — only the table names themselves changed.

## Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `email` | `VARCHAR(255)` | `NOT NULL`, unique |
| `password_hash` | `VARCHAR(255)` | nullable (not yet consumed — Phase 2) |
| `created_at` | `TIMESTAMPTZ` | default `now()` |
| `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `users_pkey` (PK), `users_email_key` (unique).

### `portfolios`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE` |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `broker` | `VARCHAR(50)` | nullable |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `portfolios_pkey` (PK), `portfolios_user_id_name_key` (unique on `user_id, name` —
one portfolio name per user, e.g. can't have two "Fidelity" portfolios for the same user).

### `holdings`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `portfolios(id)`, `ON DELETE CASCADE` |
| `symbol` | `VARCHAR(15)` | `NOT NULL` |
| `name` | `VARCHAR(200)` | nullable |
| `quantity` | `DECIMAL(18,6)` | `NOT NULL` |
| `purchase_price` | `DECIMAL(18,4)` | `NOT NULL` |
| `current_price` | `DECIMAL(18,4)` | `NOT NULL` |
| `sector` | `VARCHAR(50)` | nullable |
| `purchase_date` | `DATE` | nullable |
| `cost_basis` | `DECIMAL(18,4)` | `NOT NULL` |
| `current_value` | `DECIMAL(18,4)` | `NOT NULL` |
| `gain_loss` | `DECIMAL(18,4)` | `NOT NULL` |
| `return_pct` | `DECIMAL(10,4)` | `NOT NULL` |
| `allocation_pct` | `DECIMAL(7,4)` | nullable |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `holdings_pkey` (PK), `idx_holdings_portfolio_id`, `idx_holdings_symbol`.

### `cash_positions`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `portfolios(id)`, `ON DELETE CASCADE`, unique (one row per portfolio) |
| `amount` | `DECIMAL(18,4)` | `NOT NULL`, default `0` |
| `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `cash_positions_pkey` (PK), `cash_positions_portfolio_id_key` (unique).

### `uploads`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `portfolios(id)`, `ON DELETE CASCADE` |
| `filename` | `VARCHAR(255)` | nullable |
| `source_format` | `VARCHAR(30)` | nullable |
| `rows_parsed` | `INT8` | `NOT NULL`, default `0` |
| `rows_skipped` | `INT8` | `NOT NULL`, default `0` |
| `errors` | `JSONB` | nullable |
| `uploaded_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `uploads_pkey` (PK), `idx_uploads_portfolio_id`.

### `m_tickers`
Stock/ETF metadata reference table. Seeded 2026-07-10 from
`backend/src/db/seed/ticker_sectors.js` (218 rows) via `npm run seed:tickers`
(`backend/src/db/seedTickerData.js`). Not yet queried by any service — `parser.service.js`
still reads `ticker_sectors.js` directly for CSV-import sector fallback; only
`contrarianFinder.service.js`'s index-composition path was switched over (see
`m_index_constituent` below).

| Column | Type | Notes |
|---|---|---|
| `symbol` | `VARCHAR(15)` | PK |
| `name` | `VARCHAR(200)` | nullable, currently unpopulated by the seed script |
| `sector` | `VARCHAR(50)` | nullable |
| `is_etf` | `BOOLEAN` | default `false`, currently unpopulated (no rows flagged `true` yet) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

### `m_index_master`
One row per tracked index/sector ETF. Seeded 2026-07-10 (14 rows: `DJ30`, `NDX100`,
`SP500`, and the 11 SPDR sector ETFs `XLK`...`XLRE`) via the same seed script.

| Column | Type | Notes |
|---|---|---|
| `index_id` | `VARCHAR(10)` | PK |
| `index_description` | `VARCHAR(200)` | `NOT NULL` — e.g. "Dow Jones Industrial Average" |

### `m_index_constituent`
Index/ETF membership, one row per `(index, symbol)` pair. Seeded 2026-07-10 from
`backend/src/db/seed/cf_static_universe.js`'s `CF_STATIC` object (538 unique rows) via the
same seed script. **Live source of truth for `contrarianFinder.service.js`'s
`assembleUniverse()`** as of 2026-07-10 — the service queries this table directly instead
of importing `cf_static_universe.js` (that JS file is now only read by the one-time seed
script, not by the live request path).

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `index_id` | `VARCHAR(10)` | FK → `m_index_master(index_id)`, `ON DELETE CASCADE` |
| `symbol` | `VARCHAR(15)` | `NOT NULL`, not FK'd |

Indexes: `index_constituent_pkey` (PK), `index_constituent_index_id_symbol_key` (unique on
`index_id, symbol`), `idx_index_constituent_symbol`. (Constraint/index names retain the
pre-rename table name — see note above.)

**Re-seeding:** `npm run seed:tickers` is idempotent (`ON CONFLICT` upserts) — safe to
re-run after `cf_static_universe.js`/`ticker_sectors.js` change, to push updates into the DB.

### `schema_migrations`
Internal bookkeeping table created by `migrate.js` (not part of the app schema) —
tracks which files in `migrations/` have been applied, so re-running `npm run migrate`
is a no-op for files already applied.

| Column | Type | Notes |
|---|---|---|
| `filename` | `VARCHAR(255)` | PK |
| `applied_at` | `TIMESTAMPTZ` | default `now()` |

## CockroachDB-specific notes

- `SERIAL PRIMARY KEY` in the migration SQL compiles to `INT8 DEFAULT unique_rowid()` —
  IDs are unique but **not sequential** (not `1, 2, 3...` like Postgres/Aiven would give).
  This is expected CockroachDB behavior, not a bug.
- `idx_holdings_portfolio_id`, `idx_uploads_portfolio_id` etc. were created explicitly by
  the migration files; CockroachDB also auto-indexes FK columns, so in practice these are
  effectively redundant with the FK's own backing index. Harmless either way.
