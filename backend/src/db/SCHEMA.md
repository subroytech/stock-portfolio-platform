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
- **`m_`** — master/reference data (`m_tickers`, `m_index_master`, `m_index_constituent`,
  `m_roles`, `m_role_permissions`, `m_function_master`).
- **`tx_`** — transactional, portfolio-scoped data (`tx_portfolios`, `tx_holdings`,
  `tx_cash_positions`, `tx_uploads`). **Exception: `tx_shared_contrarian_run`** (added
  2026-08-04) is `tx_`-prefixed despite being neither portfolio-scoped nor per-user — the
  user's own call: running a Contrarian Finder scan is itself a **transaction performed by a
  role**, not an admin-exclusive system job — both `admin` and the `user-contra-*` roles can
  trigger one — so `tx_` still fits the "record of an action a user took" sense the other
  `tx_` tables carry, even though this particular action's *result* (one row per completed
  scan) is shared/global rather than scoped to that one user's own portfolio. This also sets
  the precedent for the still-open "what prefix for non-user-scoped shared/cache data"
  question `user_evt_`'s own note below flags (e.g. the on-hold shared quote cache) — future
  shared/global tables can follow this same `tx_` precedent instead of inventing a new bucket.
- **`sys_`** — internal bookkeeping, not app data (`sys_schema_migrations`).
- **unprefixed** — `users`, `users_subscriptions`, `users_roles`. Deliberately left out of the
  `tx_` bucket (they're account-level, not portfolio-scoped transactional data) and don't fit
  `m_`/`sys_` either. `users_subscriptions` (added 2026-07-12) and `users_roles` (added
  2026-07-31) are grouped with `users` rather than given their own prefix, since both are a
  child of the account itself — per-user assignment data, not reference/static data (that's
  what keeps `users_roles` out of `m_`, even though it's *about* roles).
- **`user_evt_`** — per-user event/log data (added 2026-07-31: `user_evt_usage`,
  `user_evt_usage_summary_monthly`). A new bucket, added when usage tracking didn't fit any of
  the other three: `tx_` is explicitly portfolio-scoped (usage events are user-scoped, not
  portfolio-scoped), `sys_` is explicitly internal-bookkeeping-not-app-data (usage events are
  real business data), and `m_`/unprefixed are both for relatively static, non-growing data
  (the opposite of an append-only event log). Does **not** apply to non-user-scoped event/cache
  data (e.g. a future shared quote cache, keyed by symbol not by user) — that would need its
  own bucket if/when it's built.

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
     ├──< users_subscriptions (many, one per provider e.g. fmp/finnhub)
     ├──< users_roles (many) >── m_roles (1) ──< m_role_permissions (many) >── m_function_master (1, via FK on permission_key)
     ├──< user_evt_usage (many)
     └──< user_evt_usage_summary_monthly (many)

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

**Wired into every FMP/Finnhub call site as of 2026-07-12** — `quotes.controller.ts`,
`contrarianFinder.controller.ts`, `momentum.controller.ts`, `analysis.controller.ts`,
`stockPreview.controller.ts`, and `portfolio.service.ts`'s `refreshPrices` all resolve +
decrypt the calling user's own key from this table via `userSubscription.service
.getDecryptedKey()`, instead of the global `env.fmpApiKey`. See Architecture.md Section 1.

**Admin-Master Fallback API Key (User Manual.md, added 2026-08-02)**: a user with no row here
for a given provider no longer always gets a hard `503` — `getDecryptedKey()` now falls back
to the single `admin-master`-role account's own key first, for callers whose role is `user`,
`admin`, or `user-contra-wokey` (not `user-contra-withkey`, whose entire purpose is bring-
your-own). Only if that fallback source ALSO has no key does the caller finally get a
`MissingUserApiKeyError` → `503`, with a message pointed at "contact an admin" rather than
"add your own key," since a fallback-eligible role may not even have `api_keys:manage_own`.

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

### `m_roles`
Added by migration `015`, 2026-07-31 (Architecture.md Section 3 item 6 — Functional
Authorization). Role catalog — master/reference data, same bucket as `m_index_master`.
Seeded with exactly two rows, `'user'` (every existing account was backfilled into this role
by the same migration) and `'admin'`.

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `name` | `VARCHAR(50)` | `NOT NULL`, unique |
| `created_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `m_roles_pkey` (PK), `m_roles_name_key` (unique).

### `users_roles`
Added by migration `015`. Which role(s) each user has — per-account assignment data, so
unprefixed like `users_subscriptions` rather than `m_`-prefixed (it's not itself reference
data, even though it's *about* a reference table). Schema supports many-to-many (a user could
have multiple roles), but `roles.service.ts`'s `setUserRole()` enforces a single-role-per-user
business rule for now — it replaces, not appends.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE`, part of composite PK |
| `role_id` | `INT8` | FK → `m_roles(id)`, `ON DELETE CASCADE`, part of composite PK |

Indexes: `users_roles_pkey` (composite PK on `user_id, role_id`).

### `m_role_permissions`
Added by migration `015`. Which permissions each role grants — static configuration, child of
`m_roles`, mirroring how `m_index_constituent` is the child of `m_index_master`.
`permission_key` is free-text (app-enforced vocabulary, e.g. `'contrarian_finder:scan'`,
`'roles:manage'`) rather than a DB enum, so gating a new feature never needs a schema change —
just a new `INSERT`. Checked by `requirePermission(key)` middleware.

| Column | Type | Notes |
|---|---|---|
| `role_id` | `INT8` | FK → `m_roles(id)`, `ON DELETE CASCADE`, part of composite PK |
| `permission_key` | `VARCHAR(100)` | `NOT NULL`, part of composite PK |

Indexes: `m_role_permissions_pkey` (composite PK on `role_id, permission_key`).
`permission_key` also carries a **FK** to `m_function_master(permission_key)` as of migration
`016` — a role can never be granted a permission key that isn't a real registered function.

### `m_function_master`
Added by migration `016`, 2026-08-01 (Admin Console, Architecture.md Section 3 item 6
follow-up). Catalogs only the app "functions" that are genuine **exceptions** to the default
"any signed-in user can use it" rule — deliberately **not** a row for every application
function (Momentum, Long-Term Analysis, Contrarian Comeback, and Portfolio Refresh Prices have
no row here and no `requirePermission` gate, since none of them are exceptions). Feeds the
"View/Edit Permission" screen's fixed-dropdown picker (filtered to `active`+`QA-Test` —
`Dev-WIP`/`inactive` hidden since granting those wouldn't do anything yet) and the "View/Manage
Functions" admin screen. `status` lifecycle is app-enforced (`functionMaster.service.ts`'s
`isValidStatus()`), not a DB check constraint.

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `permission_key` | `VARCHAR(100)` | `NOT NULL`, unique — referenced by `m_role_permissions.permission_key`'s FK |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `description` | `TEXT`/`STRING` | nullable |
| `status` | `VARCHAR(20)` | `NOT NULL`, default `'active'` — `'active'`\|`'inactive'`\|`'Dev-WIP'`\|`'QA-Test'` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `m_function_master_pkey` (PK), `m_function_master_permission_key_key` (unique).

Seeded with exactly 5 rows: `contrarian_finder:scan` (pre-existing, migration 015) plus the 4
new admin-capability keys this migration introduces — `roles:manage` (**re-keyed** here: used
to gate `PUT /users/:id/role`, now gates `POST /roles` instead — the existing `admin` grant row
from migration 015 didn't move, its *meaning* just shifted), `permissions:manage`,
`users:manage_roles` (takes over gating `PUT /users/:id/role`), `functions:manage`.

### `user_evt_usage`
Added by migration `015`. Raw per-user usage event log — one row per tracked action
(Momentum run, Contrarian Finder scan, Long-Term Analysis, Contrarian Comeback, portfolio
Refresh Prices), written by `usageTracking.service.ts`'s `logUsage()`. Retained via
CockroachDB's native row-level TTL (`WITH (ttl_expire_after = '35 days')`) — rows are deleted
automatically by CockroachDB's background TTL job, no cron/application cleanup code needed.

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE` |
| `feature` | `VARCHAR(50)` | `NOT NULL` — free text (app-enforced vocabulary, not a DB enum) |
| `created_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `user_evt_usage_pkey` (PK).

### `user_evt_usage_summary_monthly`
Added by migration `015`. One row per `(user_id, feature, month)`, incremented via
`INSERT ... ON CONFLICT ... DO UPDATE SET event_count = event_count + 1` on every single
`logUsage()` call — a real-time running total, not a periodic batch rollup. Retained via TTL
(`WITH (ttl_expire_after = '366 days')`) for the ~12-month cap. **Note on how the TTL actually
behaves**: CockroachDB's TTL clock resets on every row `UPDATE` (confirmed live via
`SHOW CREATE TABLE`: `ON UPDATE current_timestamp() + '366 days'`), not just at row creation —
in practice this is still correct for this table's purpose, since a given month's row only
gets updated while events for *that* month are still arriving; once the month ends, that row
stops being touched and its TTL naturally starts counting down from its last update, which is
effectively "~12 months after that month's activity finished," not "~12 months after the row
was first created."

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `user_id` | `INT8` | FK → `users(id)`, `ON DELETE CASCADE` |
| `feature` | `VARCHAR(50)` | `NOT NULL` — free text, same vocabulary as `user_evt_usage.feature` |
| `month` | `DATE` | `NOT NULL` — first of the month, e.g. `2026-08-01` |
| `event_count` | `INT8` | `NOT NULL`, default `0` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | default `now()` |

Indexes: `user_evt_usage_summary_monthly_pkey` (PK),
`user_evt_usage_summary_monthly_user_id_feature_month_key` (unique on `user_id, feature,
month` — this is what makes the `ON CONFLICT` upsert work).

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
| `today_change_dollar` / `today_change_percent` | `DECIMAL` (unconstrained) | nullable; added by migration `014`, 2026-07-31. Position-level (quantity × per-share) dollar change and percent change for the day, set alongside `price_updated_at` on every refresh — persisted so `GET /portfolios/:id` can drive the Dashboard's "Today's $" views directly from DB state, not just the ephemeral refresh-prices response |

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

### `tx_shared_contrarian_run`
Added by migration `020`, 2026-08-04. Persists the last completed Contrarian Finder scan
server-side, shared across every user — closes a real gap confirmed live the same day: since
only Admin/Admin-Master/`user-contra-*` roles can run a scan and regular users can only
*view* the outcome, a regular user (or the same admin on a different device/session) saw
nothing at all before this table existed, because results lived only in the running
browser's `sessionStorage`, never anywhere shared. See `tx_` naming-convention exception note
above for why this non-portfolio-scoped table still uses the `tx_` prefix.

**Write-once-per-scan, not per-batch**: the client-orchestrated batch-scan flow
(`useContrarianBatchScan()` in `frontend/src/api/contrarianFinder.ts`) is unchanged — one row
is written only once, when a scan reaches `phase: 'done'` successfully, with the
already-fully-assembled results (fire-and-forget `POST /contrarian-finder/last-scan`, gated
by `requirePermission('contrarian_finder:scan')` — only someone who could run a scan should
be able to claim to have completed one). An abandoned/failed scan writes no row. No
`status`/`error_message` columns for the same reason — every row is, by construction, a
completed run. "The last scan" (`GET /contrarian-finder/last-scan`, ungated — viewing isn't
the action the permission protects, same as `GET /contrarian-finder/universe`) is just
`ORDER BY completed_at DESC LIMIT 1` across every row, **regardless of tier** — the tiered
retention below is a storage/retention concern only, not a viewer-facing one (confirmed with
the user).

**Tiered retention, added by migration `021`, 2026-08-05** — `saveLastScan()`
(`contrarianFinder.service.ts`) branches on the caller's tier, resolved by the controller via
`contrarian_finder:scan_history` (a dedicated permission, not a hardcoded role-name check —
granted to `admin`/`admin-master` in this DB; any future role could be granted it too):
- **`run_tier = 'admin'`** — plain `INSERT`, appending to a shared history log, then pruned
  back to the 60 most recent admin-tier rows (`ADMIN_HISTORY_LIMIT`) after every insert.
- **`run_tier = 'user'`** — every other `contrarian_finder:scan`-permitted role
  (`user-contra-withKey`/`user-contra-wokey`). Upserts **one row per user**, not per-tier —
  a transactional `DELETE ... WHERE started_by = $1 AND run_tier = 'user'` followed by a
  fresh `INSERT`, rather than a partial-unique-index `ON CONFLICT` (simpler to reason about,
  and avoids relying on CockroachDB's partial-index `ON CONFLICT` inference). Live-verified
  2026-08-05: two runs from the same `user-contra-withKey` account leave exactly one row
  (the second run's), while two admin-tier runs leave two.

| Column | Type | Notes |
|---|---|---|
| `id` | `INT8` | PK, default `unique_rowid()` |
| `started_by` | `INT8` | FK → `users(id)`, `ON DELETE SET NULL` (not `CASCADE`) — this is shared data meant to outlive any individual account; deleting the admin who ran it shouldn't delete the result everyone's been viewing. Stored but **not yet exposed** via the API — a deliberate "store now, decide how to surface later" call |
| `completed_at` | `TIMESTAMPTZ` | `NOT NULL`, default `now()` |
| `universe_size` | `INT8` | `NOT NULL` |
| `scanned` | `INT8` | `NOT NULL` |
| `params` | `JSONB` | `NOT NULL` — the run's actual parameters (threshold, batch size, quality preset, etc.), same shape as the frontend's `RunParams` |
| `results` | `JSONB` | `NOT NULL` — the full `ScanResult[]` array. No JSONB-specific size cap in CockroachDB (bounded by overall row size, soft limit ~64 MiB); a real 348-symbol payload is ≈125KB (measured live via `pg_column_size`), nowhere close |
| `run_tier` | `VARCHAR(20)` | `NOT NULL`, default `'admin'` (migration `021`'s backfill value for the 2 pre-existing rows, both genuinely admin-run) — `'admin'` \| `'user'`, app-enforced vocabulary, not a DB check constraint, same convention as other free-text status columns in this schema |

Indexes: `tx_shared_contrarian_run_pkey` (PK). No index on `(started_by, run_tier)` yet — the
user-tier upsert's `DELETE ... WHERE started_by = $1 AND run_tier = 'user'` and the admin-tier
prune's `ORDER BY completed_at DESC LIMIT 60` both currently do a full scan of this
still-small table; worth revisiting if row count grows enough to matter.

### `m_tickers`
Stock/ETF metadata reference table — **the single source of truth for ticker
name/sector** (confirmed 2026-08-02), fed continuously from two independent paths, not just
the one-time seed:
1. **`portfolio.service.ts`'s `importHoldings()`** — every real CSV/TXT import inserts a bare
   `(symbol, sector)` row (sector from whatever `parser.service.ts` already resolved) for any
   symbol `m_tickers` doesn't know yet, `ON CONFLICT (symbol) DO NOTHING` — never overwrites a
   symbol already enriched by path 2 below.
2. **`backend/src/db/backfillTickerData.ts`** (`npm run backfill:ticker-data -- <fmp-key>`) —
   re-runnable, fetches name+sector from FMP's `/profile` endpoint
   (`marketData.service.ts`'s `getProfiles()`) for every symbol currently in
   `m_index_constituent` (the Contrarian Finder scan universe) and upserts both fields,
   `COALESCE`d so a `null` FMP response never blanks out an already-good value.

Originally seeded 2026-07-10 from `backend/src/db/seed/ticker_sectors.js` (218 rows, still
read directly by `parser.service.js` for CSV-import sector fallback — a separate, unrelated
list from the scan universe's own `cf_static_universe.js`). Confirmed 2026-08-02 these two
seed files are two independently hand-typed datasets with no enforced relationship: of the
scan universe's 348 symbols, 208 had zero `m_tickers` row at all, and 78 `m_tickers` rows
were for symbols not even in the current universe — paths 1/2 above are what closes that gap
going forward, rather than a one-time fix.

| Column | Type | Notes |
|---|---|---|
| `symbol` | `VARCHAR(15)` | PK |
| `name` | `VARCHAR(200)` | nullable — see the two population paths above |
| `sector` | `VARCHAR(50)` | nullable — see the two population paths above |
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
