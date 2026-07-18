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
→ Node.js/Express backend + CockroachDB Cloud + auth + REST API + a React frontend
  (`frontend/`, Vite + TypeScript + Tailwind v4 + React Router + TanStack Query).

**This repo's own `Architecture.md`** (problem statement, shortcomings table, target
architecture diagram, and the full accomplished/next-step/backlog plan) is the authoritative,
actively-maintained rebuild plan — check it before starting any new work. The source repo
has its own separate `Architecture.md` describing the plan from that app's perspective; it
is **not** kept in sync with this one.

---

# Architecture Decisions Already Made

| Decision | Choice | Notes |
|---|---|---|
| Backend language | Node.js / Express | Already scaffolded |
| Database | CockroachDB Cloud | Instance created at cockroachlabs.cloud; migrations written and applied |
| Backend host | Render / Railway / Fly.io | TBD — confirm with user before provisioning |
| Auth approach | Roll-your-own (bcrypt + JWT, httpOnly cookie) | Decided + built 2026-07-12 — see Architecture.md Section 1 |
| Frontend framework | React (Vite + TS) | Decided + built 2026-07-13 — Tailwind v4 (CSS-first `@theme`, npm resolved current major, not the v3 originally scoped), React Router, TanStack Query, Chart.js/`react-chartjs-2` — see Architecture.md Section 1 |
| API key strategy | Keys server-side only | FMP/Finnhub keys in backend `.env` — frontend never sees them |
| User key model | Bring-your-own (Option A), stored encrypted | Decided + storage built 2026-07-12; wired into every FMP call site the same day — see Architecture.md Section 1 |

---

# Current Build State (as of 07-13 22:30)

## Phase 0 — Foundations ✅ Done
- `backend/` + `frontend/` split in place
- `.github/workflows/ci.yml` — typecheck + lint + test on push/PR to `master`, Node 20.
  Triggers said `main` until 2026-07-11 (this repo's actual default branch is `master`, so
  the workflow had never once fired before then). Fixed, and **confirmed live** on the next
  push — GitHub Actions run #1, `success`.
- Backend fully migrated to TypeScript (`strict: true`) 2026-07-11 — see `Architecture.md`
  Section 1 for detail.

## Phase 2 — Auth & Multi-Tenancy ✅ Done
- **Auth built 2026-07-12**: roll-your-own bcrypt + JWT in an httpOnly cookie —
  `POST /auth/signup|login|logout`, `requireAuth` middleware, wired into `app.ts` with
  `cookie-parser` + CORS credentials.
- **Portfolio CRUD built 2026-07-12** (first real use of `requireAuth` through HTTP,
  and per-`user_id` scoping): `GET/POST/PUT/DELETE /portfolios`,
  `POST /portfolios/:id/import` (CSV/TXT, reuses `parser.service.ts`), and
  `POST /portfolios/:id/refresh-prices` (reuses `marketData.service.ts`/
  `livePrices.service.ts`), plus a new buy/sell `tx_portfolio_action_hist` table populated
  by diffing holdings on every import. 113 tests passing (34 new this round). Verified live
  against the real DB via the actual dev server. Full detail in `Architecture.md` Section 1.
- **User API keys built 2026-07-12**: Option A (bring-your-own) chosen; new unprefixed
  `users_subscriptions` table (one row per `user`+`provider`, extensible to future
  providers), `GET/PUT/DELETE /subscriptions`, keys AES-256-GCM encrypted via new
  `src/utils/encryption.ts` (Node's built-in `crypto`, no new dependency) — raw key never
  returned in any API response, only a masked `••••••••wxyz` value. 126 tests total (13
  new). Verified live, including confirming the DB column holds genuine ciphertext.
- **Per-user FMP keys wired into every call site — 2026-07-12**: `quotes.controller.ts`,
  `contrarianFinder.controller.ts`, and `portfolio.service.ts`'s `refreshPrices` now all
  resolve + decrypt the calling user's own key via a new `userSubscription.service
  .getDecryptedKey()`, instead of the global `env.fmpApiKey`. **Breaking change**:
  `GET /quotes` and `POST /contrarian-finder/scan` are now `requireAuth`-gated (previously
  public); a user with no key on file gets a clear 503, never a silent fallback. 130 tests
  total (4 new), `tsc`/lint clean, verified live end-to-end (401 → 503 → past-503 after
  adding a key) against the real DB. Full detail in `Architecture.md` Section 1. Finnhub
  confirmed to still have zero real implementation — this pass is FMP-only in practice.

## Phase 1 — Backend API & Data Model ✅ Done

**Done:**
- DB schema migrations in `backend/src/db/migrations/` (001–005): `users`, `tx_portfolios`,
  `tx_holdings`, `tx_cash_positions`, `tx_uploads` — written and **applied** to the
  CockroachDB Cloud `stockPortfolioAnalysis` database via `backend/src/db/migrate.js`
  (`npm run migrate`), 2026-07-10. Connection pool: `backend/src/db/pool.js`. Table-naming
  convention (`m_`/`tx_`/`sys_`/unprefixed) documented in `backend/src/db/SCHEMA.md`.
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

## Phase 3 — React Frontend ✅ Done
- **Built 2026-07-13**: full React app in `frontend/` — Login/Signup, Dashboard (portfolio
  CRUD, CSV/TXT import with replace-confirmation, KPI cards, allocation/gain-loss charts,
  refresh-prices, responsive Holdings table), Subscriptions, Contrarian Finder, Momentum,
  Stock Preview Chart. 2 new backend endpoints (`GET /momentum/:symbol`,
  `GET /stock-preview/:symbol`). Deferred: Long-Term Analysis and Contrarian Comeback
  Analysis (both promoted to Section 3 backlog, sized as new Python builds — see
  `Architecture.md`). 153 backend tests (up from 130), 22 new frontend tests.
- **3 bugs found via manual browser walkthrough, fixed same day**: Holdings table not
  switching to card view on first resize (root cause: `AllocationChart`/`PerformanceChart`
  Chart.js canvases missing a height-constrained parent); Momentum page missing its score
  breakdown; Contrarian Finder's scan giving no wait-state feedback. Full detail in
  `Architecture.md` Section 1.
- **Import preview ("Proceed w/o Replace") built 2026-07-13**: a `dryRun: true` branch on
  the existing `POST /portfolios/:id/import` (calls the already-pure `parseFile()`, zero DB
  writes — confirmed via direct row-count checks) + a new `/portfolios/:id/import-preview`
  page. Surfaces the parser's per-row `errors` to a user for the first time ever.

## Phases 4–6 — Not Started
- Phase 4: Shared quote cache (Redis / Postgres TTL table)
- Phase 5: Production hardening (Docker, Sentry, staging/prod split)
- Phase 6: Migration tool + cutover from current app

---

# Before Starting Any New Phase

Always open with `/plan` mode to walk through the decisions for that phase before writing
code. Phase 2 (auth provider, user key model) and Phase 3 (frontend framework) decisions were
expensive-to-reverse examples of why this matters — the same discipline applies to the
Python-microservices decisions ahead (Section 2/3 of `Architecture.md`).

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
