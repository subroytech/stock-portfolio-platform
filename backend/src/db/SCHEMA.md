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

## Naming convention

Tables are prefixed by category (settled 2026-07-10):
- **`m_`** — master/reference data (`m_tickers`, `m_index_master`, `m_index_constituent`).
- **`tx_`** — transactional, portfolio-scoped data (`tx_portfolios`, `tx_holdings`,
  `tx_cash_positions`, `tx_uploads`).
- **`sys_`** — internal bookkeeping, not app data (`sys_schema_migrations`).
- **unprefixed** — `users`, `users_subscriptions`. Deliberately left out of the `tx_`
  bucket (they're account-level, not portfolio-scoped transactional data) and don't fit
  `m_`/`sys_` either. `users_subscriptions` (added 2026-07-12) is grouped with `users`
  rather than given its own prefix, at the user's explicit request, since it's a child of
  the account itself.

Tables were originally created unprefixed (migrations 001–008) and renamed in two follow-up
migrations: `009_rename_master_tables.sql` (the 3 `m_` tables) and
`010_rename_transactional_tables.sql` (the 4 `tx_` tables). `sys_schema_migrations` was
renamed via a one-off manual `ALTER TABLE` (see its section below for why that one couldn't
go through a normal migration file). Internal constraint/index names (e.g.
`holdings_pkey`, `index_constituent_pkey`) were **not** renamed by CockroachDB's
`ALTER TABLE ... RENAME TO` — they still carry the original, unprefixed table name. That's
expected — only the table names themselves changed.

## Entity relationships

```
users (1) ──< tx_portfolios (many)
     │            │
     │            ├──< tx_holdings (many)
     │            ├──< tx_cash_positions (1, unique per portfolio)
     │            ├──< tx_uploads (many)
     │            └──< tx_portfolio_action_hist (many)
     │
     └──< users_subscriptions (many, one per provider e.g. fmp/finnhub)

m_index_master (1) ──< m_index_constituent (many)

m_tickers  — standalone reference table, not FK'd from anywhere
```

All child tables cascade-delete when their parent is deleted (`ON DELETE CASCADE`).

`m_tickers` and `m_index_constituent.symbol` are intentionally **not** foreign-keyed to
each other or to `tx_holdings.symbol` — they're reference/lookup data, and a symbol
appearing in a portfolio or an index shouldn't be blocked by missing metadata coverage.

## Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `email` | `VARCHAR(255)` | `NOT NULL`, unique |
| `password_hash` | `VARCHAR(255)` | nullable; bcrypt hash, set/read by `auth.service.ts` since 2026-07-12 |
| `created_at` | `TIMESTAMPTZ` | default `now()` |
| `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `users_pkey` (PK), `users_email_key` (unique).

### `users_subscriptions`
Added by migration `013`, 2026-07-12. Per-user, per-provider API key + subscription
metadata — one row per `(user_id, provider)`, so adding a future provider beyond
FMP/Finnhub needs zero schema changes (just a new value in
`userSubscription.controller.ts`'s `ALLOWED_PROVIDERS` allowlist, not a DB constraint).
Built for the "bring-your-own API key" model (Option A) the user chose over a shared
pooled backend key.

**`api_key_encrypted` is always ciphertext** — AES-256-GCM via `backend/src/utils
/encryption.ts` (Node's built-in `crypto`, no external dependency), storing
`iv:authTag:ciphertext` (hex, colon-delimited) as one string. The raw key is decrypted
server-side only to compute a masked display value (`••••••••` + last 4 chars) —
`userSubscription.service.ts`'s `listSubscriptions()`/`upsertSubscription()` never return
the plaintext key in their result. Requires `API_KEY_ENCRYPTION_KEY` (32-byte hex, separate
from `JWT_SECRET`) in the environment — validated eagerly at module load, same as
`pool.ts`'s fail-fast pattern for `DATABASE_URL`.

**Wired into every FMP call site as of 2026-07-12** — `quotes.controller.ts`,
`contrarianFinder.controller.ts`, and `portfolio.service.ts`'s `refreshPrices` all resolve
+ decrypt the calling user's own key from this table via `userSubscription.service
.getDecryptedKey()`, instead of the global `env.fmpApiKey`. A user with no row here for a
given provider gets a `MissingUserApiKeyError` → `503` from all three surfaces (no silent
fallback). See Architecture.md Section 1.

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE` |
| `provider` | `VARCHAR(50)` | `NOT NULL` — e.g. `'fmp'`, `'finnhub'`; validated against an app-level allowlist, not a DB constraint |
| `api_key_encrypted` | `TEXT`/`STRING` | `NOT NULL` — always ciphertext, never plaintext |
| `plan_tier` | `VARCHAR(50)` | nullable, free text (no DB-level enum — deliberate, per the user's own call) |
| `status` | `VARCHAR(20)` | `NOT NULL`, default `'active'` — free text, not constrained to a fixed set |
| `renewal_date` | `DATE` | nullable, **informational/self-reported only** — no automatic enforcement based on this date. Note: `node-pg` returns `DATE` columns as JS `Date` objects with a local-midnight quirk (observed live: `2027-01-01` round-tripped through the API as `2027-01-01T05:00:00.000Z`) — cosmetic, but worth knowing before a frontend renders this naively |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `users_subscriptions_pkey` (PK), `users_subscriptions_user_id_provider_key`
(unique on `user_id, provider` — this is what makes `upsertSubscription()`'s
`ON CONFLICT (user_id, provider) DO UPDATE` update-in-place instead of erroring/duplicating).

### `tx_portfolios`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE` |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `broker` | `VARCHAR(50)` | nullable |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `portfolios_pkey` (PK), `portfolios_user_id_name_key` (unique on `user_id, name` —
one portfolio name per user, e.g. can't have two "Fidelity" portfolios for the same user).

### `tx_holdings`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `tx_portfolios(id)`, `ON DELETE CASCADE` |
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
| `price_updated_at` | `TIMESTAMPTZ` | nullable; added by migration `011`, 2026-07-12. Stamped by `POST /portfolios/:id/refresh-prices` **per holding**, only for holdings that actually got a fresh quote — see `tx_portfolio_action_hist` section below for why this is per-holding, not per-portfolio |

Indexes: `holdings_pkey` (PK), `idx_holdings_portfolio_id`, `idx_holdings_symbol`.

### `tx_cash_positions`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `tx_portfolios(id)`, `ON DELETE CASCADE`, unique (one row per portfolio) |
| `amount` | `DECIMAL(18,4)` | `NOT NULL`, default `0` |
| `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `cash_positions_pkey` (PK), `cash_positions_portfolio_id_key` (unique).

### `tx_uploads`
| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK |
| `portfolio_id` | `INT8` | FK → `tx_portfolios(id)`, `ON DELETE CASCADE` |
| `filename` | `VARCHAR(255)` | nullable |
| `source_format` | `VARCHAR(30)` | nullable |
| `rows_parsed` | `INT8` | `NOT NULL`, default `0` |
| `rows_skipped` | `INT8` | `NOT NULL`, default `0` |
| `errors` | `JSONB` | nullable |
| `uploaded_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `uploads_pkey` (PK), `idx_uploads_portfolio_id`.

### `tx_portfolio_action_hist`
Added by migration `012`, 2026-07-12. Buy/sell history — one row per symbol whose quantity
changed on a given `POST /portfolios/:id/import`, populated by diffing the old holdings
snapshot against the newly parsed one (`delta = newQty − oldQty`; `delta > 0` → `BUY`,
`delta < 0` → `SELL`, `delta === 0` → no row — this covers partial quantity changes, not
just brand-new/fully-closed positions). A symbol dropped entirely still gets a `SELL` row,
using its last-known price (the new import has no price for a symbol it doesn't contain).

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `portfolio_id` | `INT8` | FK → `tx_portfolios(id)`, `ON DELETE CASCADE` |
| `symbol` | `VARCHAR(15)` | `NOT NULL` |
| `action_type` | `VARCHAR(4)` | `NOT NULL` — `'BUY'` or `'SELL'` |
| `quantity_delta` | `DECIMAL(18,6)` | `NOT NULL`, always positive — direction comes from `action_type` |
| `price` | `DECIMAL(18,4)` | `NOT NULL` — the imported price, or the last-known price for a fully-sold symbol |
| `action_date_time` | `TIMESTAMPTZ` | default `now()` |

Indexes: `tx_portfolio_action_hist_pkey` (PK — this table was created post-rename, so
unlike the other `tx_`/`m_` tables its constraint name actually matches the live table
name), `idx_portfolio_action_hist_portfolio_id`.

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
pre-rename table name — see the naming-convention note above.)

**Re-seeding:** `npm run seed:tickers` is idempotent (`ON CONFLICT` upserts) — safe to
re-run after `cf_static_universe.js`/`ticker_sectors.js` change, to push updates into the DB.

### `sys_schema_migrations`
Internal bookkeeping table created/maintained by `migrate.js` (not part of the app schema)
— tracks which files in `migrations/` have been applied, so re-running `npm run migrate`
is a no-op for files already applied.

Renamed from `schema_migrations` on 2026-07-10 via a **manual, one-off `ALTER TABLE`** —
not a numbered migration file. This table is what the migration loop itself depends on for
bookkeeping: replaying the rename through the normal apply-then-record flow would have the
loop try to write its own tracking row to a table it had just renamed out from under itself,
crashing. `migrate.js` was updated in the same commit to reference the new name. A brand-new
environment never needs this manual step — `migrate.js`'s `CREATE TABLE IF NOT EXISTS` just
creates `sys_schema_migrations` directly from the start.

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
- `ALTER TABLE ... RENAME TO` does not rename dependent constraint/index names — see the
  naming-convention note above.
