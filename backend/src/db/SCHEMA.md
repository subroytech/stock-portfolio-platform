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
```

All child tables cascade-delete when their parent is deleted (`ON DELETE CASCADE`).

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
