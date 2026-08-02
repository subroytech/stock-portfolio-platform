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
| E2E testing framework | Playwright + Cucumber (`playwright-bdd`) | Decided 2026-07-21 — originally proposed as Selenium+Cucumber, switched to Playwright's engine for auto-waiting/less CI flakiness; single pilot golden-path scenario in new `e2e/`, see Architecture.md Section 3 item 1 |

---

# Current Build State (as of 07-29)

## Phase 0 — Foundations ✅ Done
- `backend/` + `frontend/` split in place
- `.github/workflows/ci.yml` — typecheck + lint + test on push/PR to `master`, Node 20.
  Triggers said `main` until 2026-07-11 (this repo's actual default branch is `master`, so
  the workflow had never once fired before then). Fixed, and **confirmed live** on the next
  push — GitHub Actions run #1, `success`.
- Backend fully migrated to TypeScript (`strict: true`) 2026-07-11 — see `Architecture.md`
  Section 1 for detail.

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

## Section 3 Backlog Item 1 — E2E pilot suite ✅ Done
Scaffolded 2026-07-21 (Playwright + Cucumber `playwright-bdd`, single golden-path scenario:
Signup→Login→Portfolio→Import→Dashboard KPIs), positioned ahead of Long-Term
Analysis/Contrarian Comeback/the Python extraction items so it's a regression net through
that riskier work. **Confirmed fully done 2026-07-29**: the dedicated CockroachDB Cloud test
database and `E2E_DATABASE_URL` GitHub secret are both provisioned and working — verified via
GitHub Actions history (the `e2e` job, which fails fast on a missing `DATABASE_URL`, has
passed on every run since at least 2026-07-23). **Tab-shell mechanics now covered too,
2026-07-29**: new `e2e/features/tab-navigation.feature` (2 scenarios — tab-switch state
preservation, API Keys modal open/close), reusing `TabShell.tsx`'s existing `data-testid`s
(zero new ones needed). All 3 scenarios verified live against the real test DB. **Still
deliberately deferred**: the actual analysis tools (Momentum/Contrarian Finder/Long-Term
Analysis/Contrarian Comeback) and the cross-tab launchers need either a live FMP test key in
CI or Playwright route-mocking to exercise meaningfully — neither decided yet. See
Architecture.md Section 3 item 1.

## Python Service Scaffolding — analysis-service ✅ Done
Built 2026-07-24 — Section 2's "Next Step" is now landed. New `analysis-service/` (FastAPI,
Poetry, first Python/Docker in this repo) exposes `GET /health`; Node proxies it at
`GET /analysis/health` (`requireAuth`-gated, same as every other proxied route), following
the existing `stockPreview.controller.ts` thin-proxy pattern. Verified live end-to-end: the
full round-trip (client → Node auth-check → Python → back through Node) returns 200, and
killing the Python process degrades to a clean 503 rather than a crash. 158 backend tests
(up from 153), new independent `analysis-service` CI job (hard-gated, no
`continue-on-error`, unlike `e2e`). **Known gap**: Docker itself isn't installed on the
machine this was built on, so the `Dockerfile` is unverified by an actual build/run — only
the direct `poetry run uvicorn` path was live-tested. Full detail in `Architecture.md`
Section 1.

## Long-Term Analysis (Section 3 item 2) ✅ Done
Built 2026-07-26 — the first real business logic in `analysis-service` and the first full
Node→Python feature exercise. Ported the deterministic point-scoring model from the source
app's `lt-analysis.html` (not the newer, qualitative `lt-mt-stock-analyzer` skill — that
needs an LLM+web-search workflow, not deployable as a stateless FastAPI endpoint; the two
now serve different surfaces). V1 adds Forward P/E, EV/EBITDA, and a labeled peer-group
"sector" approximation on top of the ported metrics, plus Finnhub company-news — **the first
feature in the platform to actually consume a user's stored Finnhub key** (fixed
`SubscriptionsPage.tsx`'s now-stale "not used by any feature yet" copy). Node
(`longTermAnalysisData.service.ts`, new) owns all FMP/Finnhub calls + the user's decrypted
keys and fetches in parallel; Python (`analysis-service/app/scoring/long_term.py`) does pure
scoring/computation only, including reactivating a forward-P/E scoring rule that was
historically dead code in the source app (it read a field that doesn't exist in FMP's
`/stable` tier, so it silently never fired) — confirmed real forward EPS data is sourceable
via FMP before flipping it live. New `GET /analysis/long-term/:symbol` (`requireAuth`-gated),
new `LongTermAnalysisPage.tsx` following the Momentum page's ticker-form/mutation pattern.
33 new Python tests, 15 new backend tests (170 total), 2 new frontend tests (29 total) —
`tsc`/lint clean on both backend and frontend. **Manually verified live 2026-07-26/27
against a real FMP account — 3 real bugs found and fixed**: peers were always empty
(`/stable/stock-peers` returns the peer list as a flat array, not wrapped in `peersList`);
earnings-surprise data was wrong (`/stable/earnings-calendar?symbol=X` ignores `symbol`
entirely and returns that day's market-wide calendar — fixed to use `/stable/earnings`);
peer P/E was always null (`/stable/quote` has no `pe` field — fixed by deriving it from
`1/earningsYield`, already fetched via `key-metrics`). **Confirmed real, not a bug**:
Forward P/E stays `null` because `/stable/financial-estimates` returns `[]` on this
account's plan tier — degrades gracefully exactly as designed. Full detail in
`Architecture.md` Section 1.

## Contrarian Comeback Analysis (Section 3 item 3) ✅ Done
Built 2026-07-28 across 3 formally-planned phases (gate/auto-checks + 5-factor score +
verdict; Fundamental Health + Catalyst Pipeline; Staged Entry + Recovery Targets + Thesis
Invalidation) — greenfield in Python, ported from the source app's `contrarian-analysis.html`
(re-read verbatim, not assumed from the earlier Phase-3 scoping note). Stateless two-endpoint
pattern (`POST /contrarian-comeback/gate` preview, `POST /contrarian-comeback` full submit).
New `ContrarianComebackPage.tsx`. Real bug found+fixed live: `/v4/insider-trading` is a
retired FMP legacy endpoint (403 on accounts created after 2025-08-31) — switched to
`/stable/insider-trading/search`. Merged via PR #3. Full detail in `Architecture.md` Section 1.

## Top-Level UI Restructure, Cross-Tab Launchers, and Data Fixes ✅ Done
Built 2026-07-29. Persistent-tabs restructure: the 5 tools collapsed into one always-mounted
`TabShell.tsx` (single `path="/*"` route) so switching tabs no longer resets in-progress
state; API Keys became a modal instead of its own route. New `frontend/src/lib/
tickerHandoff.ts` context lets Contrarian Finder/Momentum rows launch Long-Term Analysis or
Contrarian Comeback directly for a symbol (own table column, not inline with the symbol).
Contrarian Comeback fixes: trailing P/E was always `null` (same FMP `/stable` `pe`-field gap
Long-Term Analysis hit — fixed via price/EPS derivation), added Volume Ratio %/Volume Climax
detection, compact (M/B/T) Free Cash Flow formatting, context-aware tooltips. Merged via
PR #4. Full detail in `Architecture.md` Section 1.

## Momentum Analysis extraction (Section 3 item 4) ✅ Done
Built 2026-07-29 — the first **extraction** (not greenfield build) of the Python
microservices work. `momentum.service.ts`'s pure math (SMA/EMA/RSI/MACD/Bollinger Bands, the
5-factor score) ported to `analysis-service/app/scoring/momentum.py` as a faithful
line-for-line transliteration (TS/Python floats are both IEEE 754 doubles, so exact operation
order is what makes parity possible). `calcKellySizing` NOT ported — stays client-side only
(`frontend/src/lib/kelly.ts`). Shadow-test discipline: the relevant Jest fixtures ported 1:1
into `test_momentum_scoring.py` (17 new Python tests, 139 total), same inputs/expected
outputs, rather than a live dual-engine comparison (no real production traffic to shadow at
this project's scale). Zero frontend/route changes — `GET /momentum/:symbol`'s response
shape is byte-identical; only `momentum.controller.ts` internally swapped to
`analysisService.computeMomentumAnalysis()`. `momentum.service.ts`/its 22-test Jest file stay
in the repo undeleted as the rollback path. 1 new backend test (201 total), `tsc`/lint clean.
Verified live against a real FMP account. Full detail in `Architecture.md` Section 1.

**Correction discovered same day**: `contrarianFinder.service.ts` imports `mwSMA`/`mwRSI`/
`mwBB` directly from `momentum.service.ts` for its own Strength List scoring — that file was
never fully dead code even before its own extraction below, so "delete momentum.service.ts
once confident" (mentioned above) would only ever be a partial trim (`assembleMomentumAnalysis`/
`calcKellySizing` only), never a whole-file deletion.

## Contrarian Finder extraction (Section 3 item 4) ✅ Done
Built 2026-07-29 — the last Section 3 backlog item. Data-ownership decision (pros/cons
comparison): Node stays the sole DB owner — `assembleUniverse()`/`fetchSectorMap()`'s two
read-only `SELECT`s against static reference data were too small to justify Python getting its
own CockroachDB connection for the first time. Real complexity vs. Momentum: `scanStock()`
interleaved the FMP fetch and scoring in one function, so this extraction had to introduce
the fetch/compute split, not just relocate an already-separated function — new
`fetchStockData()`/`assembleScanBatch()` in `contrarianFinder.service.ts`, new
`analysis-service/app/scoring/contrarian_finder.py` **reusing `mw_sma`/`mw_rsi`/`mw_bb` from
the already-ported `momentum.py`** (the direct payoff of doing Momentum first). Today's
`scanStock()`/`scanBatch()`/`filterCandidates()` stay undeleted as the rollback path.
Shadow-test: 6 relevant Jest cases + 1 new null-quote case ported to pytest (149 Python tests
total). 8 new backend tests (209 total, including a design fix — an initial dead
`Promise.allSettled` error-branch was simplified out after discovering `fetchStockData` can
never actually reject). `tsc`/lint clean. Verified live: a real 15-symbol batch scan through
the new path returned correct sector overlays, pricing, and strength scoring. Full detail in
`Architecture.md` Section 1. **No more Python extractions remain in Section 3.**

## Next Up — Two New Items Queued (2026-07-31), Then Phases 4–6

- **Functional Authorization (RBAC) + Usage Tracking Module** — scoping, design discussed,
  not yet planned for implementation. Gate specific features by role (Contrarian Finder's
  "Run Scan" → admin-only first) and log per-user usage across analysis features toward
  future subscription tiering. See `Architecture.md` Section 3 item 6 for the full
  table-naming design (`m_roles`/`m_role_permissions`/`users_roles`/`user_evt_usage`/
  `user_evt_usage_summary_monthly`) and the `/auth/me` gap it surfaced.
- **Contrarian Finder stock universe overhaul** — early discussion, not yet planned. The
  `m_tickers`/`m_index_master`/`m_index_constituent` tables are already the live source for
  scans, but the data itself is still the original hand-typed pre-DB snapshot. See
  `Architecture.md` Section 3 item 7.
- Phase 4: Shared quote cache — **⏸ on hold, deferred by the user 2026-07-29**, now also
  queued behind the two items above. Design already settled though (CockroachDB TTL table
  over Redis, UPSERT-keyed by symbol, TTL window = the retention rule) — see
  `Architecture.md` Section 3 item 8 for the full reasoning, ready to resume from whenever
  this gets picked back up. Table naming (doesn't fit `m_`/`tx_`/`sys_`/unprefixed, and
  `user_evt_` doesn't apply either since this cache isn't per-user) is the one still-open
  decision.
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
