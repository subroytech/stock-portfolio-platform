# MUST DO — Before Any Code Change

**RULE: Never initiate any code change without explicit confirmation from the user.**

Before editing, creating, or deleting any file:
1. Describe what you plan to change and why
2. Wait for the user to say "go ahead", "yes", "proceed", or equivalent
3. Only then make the change

---

# What This Repo Is

This is the **rebuild** of the stock portfolio dashboard — a ground-up rewrite turning a
single-user, client-side-only app into a scalable multi-user platform with a real backend,
database, and auth.

**Source (working app):** `../CreateStockPortfolioViewWOSkill`
→ Vanilla JS + HTML, no backend, `localStorage` as the only persistence layer, FMP/Finnhub
  API keys stored in browser `localStorage` (visible in DevTools).

**This repo:** `stock-portfolio-platform`
→ Node.js/Express backend + CockroachDB Cloud + auth + REST API.
  Frontend is a placeholder — not started yet.

The full Architecture document (problem statement, shortcomings table, target architecture
diagram, and all 6 phases in detail) lives in the source repo at:
`../CreateStockPortfolioViewWOSkill/Architecture.md`

---

# Architecture Decisions Already Made

| Decision | Choice | Notes |
|---|---|---|
| Backend language | Node.js / Express | Already scaffolded |
| Database | CockroachDB Cloud | Instance created at cockroachlabs.cloud; migrations written and applied |
| Backend host | Render / Railway / Fly.io | TBD — confirm with user before provisioning |
| Auth approach | TBD | Choices: roll-your-own (bcrypt + JWT) vs. managed (Clerk / Auth0). Decide before Phase 2 |
| Frontend framework | TBD | Vanilla JS (lower effort) vs. React/Vue/Svelte (recommended once auth/routing enter the picture) — decide in Phase 3 |
| API key strategy | Keys server-side only | FMP/Finnhub keys in backend `.env` — frontend never sees them |
| User key model | TBD | Each user brings own FMP/Finnhub key (stored encrypted) vs. shared pooled key with per-user quota. Decide in Phase 2 |

---

# Current Build State

## Phase 0 — Foundations ✅ Done
- `backend/` + `frontend/` split in place
- `.github/workflows/ci.yml` — lint + test on push/PR to `main`, Node 20
- `frontend/index.html` is a placeholder only

## Phase 1 — Backend API & Data Model ⚠ Partially Done

**Done:**
- DB schema migrations in `backend/src/db/migrations/` (001–005): `users`, `portfolios`,
  `holdings`, `cash_positions`, `uploads` — written and **applied** to the CockroachDB Cloud
  `stockPortfolioAnalysis` database via `backend/src/db/migrate.js` (`npm run migrate`),
  2026-07-10. Connection pool: `backend/src/db/pool.js`.
- REST endpoints built: `GET /quotes` and `POST /contrarian-finder/scan`
- FMP/Finnhub keys moved to `backend/.env.example` + `src/config/env.js`
- Rate limiting middleware: `src/middleware/rateLimit.js` (wraps `/quotes` and `/contrarian-finder`)
- Services ported from source repo: `parser.service.js`, `momentum.service.js`,
  `contrarianFinder.service.js`, `livePrices.service.js`, `marketData.service.js`
  — each has a matching test file in `backend/tests/`
  - **Synced 2026-07-08** against the source repo's current state (they had drifted since
    the initial ~June 23 port): `momentum.service.js`'s `calcKellySizing` now has the
    score-gating fix (no entry <6, floor only ≥7); `marketData.service.js`'s `fmpGet`/
    `getQuotes` now use the unified timeout + 401/402/403/429 handling; `contrarianFinder
    .service.js`'s `assembleUniverse` is static-only (no more live constituent-fetch
    attempts), `scanStock` takes a configurable `scanDays` instead of a hardcoded 5-day
    window, its `change5d` field was renamed to `changePct`, and it now also runs the
    "Strength List" enrichment screen. See `Incoming-Implementation/source-app-functions.md`
    for the authoritative current behavior — **re-check that doc's own "Last updated" date
    before assuming these services are still in sync**, since there's no automated sync.
- Seed data ported: `cf_static_universe.js`, `empower_sector_map.js`, `header_aliases.js`,
  `ticker_sectors.js`
- **2026-07-10 — new DB tables `m_tickers`, `m_index_master`, `m_index_constituent`**
  (`m_` prefix marks reference/master-data tables, distinct from transactional tables —
  see `backend/src/db/SCHEMA.md`), seeded from the JS files above via
  `npm run seed:tickers` (idempotent). `contrarianFinder.service.js`'s `assembleUniverse()`
  now queries `m_index_constituent` live instead of importing `cf_static_universe.js` — this
  is a platform-specific enhancement with **no equivalent in the source app**, so don't
  expect to find it when diffing against `source-app-functions.md`. `parser.service.js`
  still reads `ticker_sectors.js` directly (untouched) — the `m_tickers` table exists but
  isn't queried by any service yet.

**Not yet built in Phase 1:**
- `POST /auth/signup` and `POST /auth/login`
- `GET / POST / PUT /portfolios` CRUD endpoints
- (DB is provisioned and migrated — these are no longer blocked, just not written yet)

## Phases 2–6 — Not Started
- Phase 2: Auth & multi-tenancy
- Phase 3: Frontend refactor + responsive design
- Phase 4: Shared quote cache (Redis / Postgres TTL table)
- Phase 5: Production hardening (Docker, Sentry, staging/prod split)
- Phase 6: Migration tool + cutover from current app

---

# Before Starting Any New Phase

Always open with `/plan` mode to walk through the decisions for that phase before writing
code. Phase 2 decisions (auth provider, user key model) and Phase 3 decisions (frontend
framework) are expensive to reverse once data is flowing — plan them first.

---

# Cross-Repo Context

The source app (`../CreateStockPortfolioViewWOSkill`) is still the live working tool.
As of 2026-07-08 it has: a standalone Momentum ticker input, Kelly score-gating, a
Strength List tab (with hover-tooltip help text in `momentum-help.js`), a fully static
Contrarian Finder universe with configurable batch/wait controls, a `tests/` directory
(Node's built-in test runner), and a single shared `fmpGet()` fetch wrapper replacing
what used to be four separate implementations. All of the above is now reflected in
this backend's `momentum.service.js`/`contrarianFinder.service.js`/`marketData.service.js`
as of the 2026-07-08 sync noted above — but this list, like that sync, will go stale the
next time the source app changes meaningfully.

When porting features here, check the source repo's `FEATURES.md` and
`Incoming-Implementation/source-app-functions.md` for the current implementation
details before writing backend equivalents — don't assume this file's summary is current.
