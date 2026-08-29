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

# Current Build State (as of 08-28)

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

**2026-08-14 — Python version pin bumped 3.12 → 3.14**: local dev only ever had Python 3.14
installed (no 3.12 anywhere on the machine), so Poetry had been silently resolving the
`^3.12` constraint against 3.14 all along — the "tested" version was actually 3.14, not the
3.12 the `Dockerfile`/CI claimed. Repinned all three to `3.14` for consistency
(`analysis-service/pyproject.toml`, `analysis-service/Dockerfile`'s `python:3.14-slim` base,
and `.github/workflows/ci.yml`'s `actions/setup-python` step) and regenerated
`poetry.lock` — `poetry install` + all 149 Python tests verified passing under the new lock.
**Known gap unchanged and now also covers this**: since Docker still isn't installed on this
machine, `python:3.14-slim` actually pulling/building has *not* been verified — only the
constraint/lock/local-venv side of this change is confirmed.

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

## Functional Authorization (RBAC) + Admin Console ✅ Done
Built across 8 phases, 2026-07-31–08-02. Full RBAC schema (`m_roles`/`m_role_permissions`/
`m_function_master`/`users_roles`, migrations 015–018), `requirePermission` middleware
(DB-backed, no hardcoded role-name checks), `GET /auth/me` now returns resolved
`roles`+`permissions` (closing the old probe-`/portfolios`-and-catch-401 gap), a dedicated
`/admin` console (My API(s)/Manage Users/Functions/Permission/Role, edit-then-save UX),
permission-based gating on Contrarian Finder's Run Scan + API Keys, Manage Users filters, and
an Admin-Master Fallback API Key model (3 custom roles modeling bring-your-own-key vs. shared
fallback — see `User Manual.md`). Usage Tracking is only partial: the `user_evt_usage`/
`user_evt_usage_summary_monthly` tables + `usageTracking.service.ts` exist and log Contrarian
Finder scans, but weren't extended to every analysis controller — see Next Up.

## Contrarian Finder Stock Universe + m_tickers sync ✅ Done
Built 2026-08-02–03 — tackled Architecture.md Section 3 item 7 from a "make the metadata
usable" angle, not "replace the static constituent list" (that question's still open — see
Next Up). New `GET /contrarian-finder/universe` reference table (visible to everyone).
`m_tickers` (name/sector/market_cap, migration 019 adds the last one) is now kept populated
from two live paths — Portfolio Update inserts, and a shared `refreshTickerDataBatch()` used
by both "Run Scan (+ Mkt Cap)" (a confirm-gated link, piggybacks a full refresh on the scan's
own batching) and the Admin Console's new "Master Data" Delta Update tab (missing-only,
admin-only). Real bugs found live: BTC/ETH prices never updated on Refresh Prices (FMP needs
the `BTCUSD` pair format, not bare `BTC`); a `HoldingsTable.tsx` Major/Minor-tabs regression
(null allocation defaulted to hidden, not shown) and a flaky `useLogout` test and an outdated
E2E permission assumption were all caught by the real E2E suite failing in CI for the first
time ever — all fixed, all 4 CI jobs (backend/frontend/analysis-service/e2e) confirmed green.

## Contrarian Finder — shared last-scan persistence ✅ Done
Built 2026-08-04 — closed a real gap the user found by hand: since only Admin/Admin-Master/
`user-contra-*` roles can run a Contrarian Finder scan and everyone else can only *view* the
outcome, a regular user (or the same admin on a different device/session) previously saw
nothing at all, because results lived only in the running browser's `sessionStorage`, never
anywhere shared. New `tx_shared_contrarian_run` table (migration 020 — deliberately `tx_`-
prefixed despite the result being shared/global, not portfolio-scoped: running a scan is
itself a transaction performed by a role, not an admin-exclusive job — both `admin` and
`user-contra-*` can trigger one — so `tx_` still fits; documented exception in `SCHEMA.md`.
Stores `started_by` but doesn't expose it via the API yet). `POST /contrarian-finder/last-scan`
(`requirePermission('contrarian_finder:scan')` — only someone who could run a scan can claim
to have completed one) is called fire-and-forget by the frontend once a scan reaches `done`;
`GET /contrarian-finder/last-scan` is ungated (same "viewing isn't the action" reasoning as
`GET /contrarian-finder/universe`) and used by a new `useLastScanFallback()` hook.
`ContrarianFinderPage` now shows the run's completed-at timestamp. 10 new backend tests (385
total), 4 new frontend tests (229 total), `tsc`/lint clean both sides. **Real bug found+fixed
via live 2-account verification**: `universe_size`/`scanned` (INT8 columns) came back from
CockroachDB as strings, not numbers — same `node-pg` gotcha as `roles.service.ts`/
`marketData.service.ts`, fixed with the same `Number()` coercion. Verified live: a plain `user`
account saw `{ lastScan: null }` before any scan existed, got 403 posting directly, then saw an
admin account's saved scan appear via `GET` in a completely separate session.

**Follow-up bug found+fixed 2026-08-05, reported by the user in real use**: `useLastScanFallback()`
originally only fired when a viewer's browser had *no* local scan data at all — the first time
a plain-`user` account ever visited, it cached whatever the shared result was at that moment
(in both the QueryClient cache and `sessionStorage`), then never re-checked again for that
browser session, even across page reloads. A viewer could get permanently stuck seeing a
days-old result while an admin ran newer scans in the meantime. Confirmed live the backend was
never the issue (a fresh account with zero local cache always got the true newest record).
Fixed by making the fallback check fire on every mount unconditionally (cheap, ungated GET),
applying its result only when it's actually newer (`completedAt` comparison) than whatever's
currently shown — self-heals a stale view without ever clobbering a run the same session just
completed itself (guarded by `isPending` and the newer-only check). 1 test replaced with 2
(one covering the upgrade-when-stale case, one covering never-downgrade-a-fresh-local-run),
231 frontend tests total.

## Contrarian Finder — tiered last-scan retention ✅ Done
Built 2026-08-05 — the user noticed the shared-scan table (above) was accumulating one row per
completed run indefinitely and asked for tiered retention instead: keep a rolling **60-run
history** for `admin`/`admin-master`, but **upsert a single row per user** for every other
`contrarian_finder:scan`-permitted role (`user-contra-withKey`/`user-contra-wokey`). Migration
`021` adds a `run_tier` column (`'admin'` | `'user'`, backfilled `'admin'` for the 2
pre-existing rows) and a new `contrarian_finder:scan_history` permission, granted to `admin` via
the migration and to `admin-master` via a direct grant (that role is never migration-seeded —
same precedent as its other manually-configured grants). `saveLastScan()` branches on tier:
admin appends then prunes back to the 60 most recent admin-tier rows; user does a transactional
`DELETE` + `INSERT` keyed on `started_by`, not a partial-unique-index `ON CONFLICT` (simpler to
reason about, confirmed via the same DELETE+INSERT pattern `roles.service.ts`'s `setUserRole()`
already established). The controller resolves tier via `rolesService.getUserPermissions()` —
permission-based, not a hardcoded role-name check, consistent with the rest of this RBAC system.
`GET /contrarian-finder/last-scan` is deliberately unaffected — still just the single most
recent row across both tiers (confirmed with the user: a storage/retention change only, not a
viewer-facing one). 5 new backend tests, `tsc`/lint clean. **Live-verified with two throwaway
accounts**: an `admin` account running twice left 2 accumulating rows; a `user-contra-withKey`
account running twice left exactly 1 row (the second run replaced the first).

## Permission dependency guard + Manage Permission UI indent ✅ Done
Built 2026-08-05, same day — a follow-on question ("should `contrarian_finder:scan` and
`contrarian_finder:scan_history` be mutually exclusive?") surfaced that `scan_history` is
actually a strict **child** of `scan` (it only means anything alongside the parent — the tier
check in `saveLastScan`'s controller only runs after `requirePermission('contrarian_finder
:scan')` has already let the request through), so granting the child alone via the Admin
Console would silently do nothing. `roles.service.ts` gets a small, generic `PERMISSION_REQUIRES`
map (not a full dependency graph — this is currently the only such pair) enforced both
directions: `grantPermission()` now throws `MissingParentPermissionError` (→ `400`) if the
parent isn't already granted; `revokePermission()` throws `ParentPermissionInUseError` (→ `409`)
if a granted child still depends on the permission being revoked. `RolePermissionsPage.tsx`
mirrors the same map for **display only** (a `withParentChildOrder()` reorder so the child
renders indented directly under its parent with a `↳` marker, instead of sorting to its own
alphabetical position — "Contrarian Finder Scan History" would otherwise land well *before*,
not after, "Run Contrarian Finder Scan"). 6 new backend tests, 1 new frontend test, `tsc`/lint
clean both sides. Live-verified via the real Admin Console API against a throwaway role: grant
child without parent → `400`; grant parent then child → both `200`; revoke parent while child
still granted → `409`; revoke child then parent → both `200`.

## Contrarian Finder — SP500 tier expanded to top 400 ✅ Done
Built 2026-08-05 — resolved the "keep hand-curating `cf_static_universe.ts`'s SP500 list, or
source live index membership from FMP" open question in favor of a live-data-driven
regeneration of the static file, not a runtime FMP dependency. The official S&P 500 membership
endpoint doesn't work on the current FMP plan (`/stable/sp500-constituent` 402s; legacy
`/v3/sp500_constituent` is retired) — confirmed live before choosing the fallback: a one-time,
throwaway `ts-node` script pulled `/stable/company-screener` (real market-cap-ranked US
companies) and rebuilt the SP500 array as a top-400-by-market-cap proxy, fully replacing the
old 200 (not appending) — this also fixes a real, previously-confirmed gap (MU, INTC, AMAT,
ORCL, PLTR, PANW were all missing). Getting a clean list took several rounds of hand-verified
filtering: the raw screener mixed in preferred stock/notes/trusts with bogus inflated market
caps, at least one outright private company (SPCX/SpaceX), and OTC-traded subsidiary
instruments — all caught by spot-checking suspicious symbols live via `/stable/quote` before
trusting them, not assumed. `dj30`/`ndx100`/`etf` arrays and their DB rows are byte-for-byte
untouched (confirmed live: 30/88/20-per-ETF, unchanged).

**Real bug this surfaced**: `assembleUniverse()`'s `CF_MAX = 450` cap would have silently
truncated the ETF tier out of every scan once SP500 grew (ETFs are added last) — raised to
`600`. Live dedup simulation against the real expanded table: the actual post-expansion total
is 458 (not the ~540-600 pre-implementation estimate — the real top-400 list overlaps more
with the ETF tier than assumed), confirmed via a real `scan-batch` API call
(`universeSize: 458`, `totalBatches: 4`). Frontend's default `maxBatches` raised 3→5 (625
symbols) so a plain "Run scan" click covers the full universe without needing the Advanced
panel. `m_index_constituent`'s upsert-only seeding never removes stale rows, so a one-time
manual prune (`DELETE ... WHERE index_id = 'SP500' AND symbol NOT IN (new 400)`) removed the
35 tickers that didn't make the new list. 1 new backend test (`assembleUniverse`'s `CF_MAX`
boundary, 396 total), several existing frontend tests updated for the new default (230 total),
`tsc`/lint clean both sides.

## Portfolio Upload — Flex ✅ Done

Built across 5 formally-planned phases, 2026-08-07 (scoped through extensive discussion
2026-08-06/07, then `/plan`-approved and executed in one continuous "auto mode" session). With
"appifying" the platform in mind: a general-purpose import path that doesn't need a hardcoded
per-broker parser for every new source, alongside — not replacing — today's working import.

### Scope split
- **"Portfolio Upload — Legacy"** — today's existing `parser.service.ts` (`parseGenericCsv` +
  `HEADER_ALIASES`, and the positional `parseRobinhoodTxt`) stays exactly as-is, untouched,
  covering Fidelity/Empower/Robinhood.
- **"Portfolio Upload — Flex"** (Phase 1, this effort) — a new, parallel import path for any
  CSV/XLS file with *some* header row, built around reusable, admin-governed **templates**
  rather than a hardcoded parser per broker.
- **Phase 2 (explicitly deferred)** — teach Flex to also accept linear/positional formats like
  Robinhood's (no real header row today) by first generating an equivalent header row from
  them, so they could eventually feed the same Flex pipeline instead of needing their own
  hardcoded parser like `parseRobinhoodTxt`.

### RBAC / UI shape
- Both `Portfolio-Legacy` and `Portfolio-Flex` are gated Functions in the Authorization Module
  (`portfolio_upload:legacy` / `portfolio_upload:flex`, migration 024) — a real behavior change,
  since portfolio import had no permission gate before. Resolved via `AskUserQuestion` during
  planning: `user` gets `portfolio_upload:legacy` only by default (nobody loses today's import);
  `portfolio_upload:flex` stays admin-granted-only. `admin`/`admin-master` get all 3 new
  permissions (the third being the approval function below).
- A third gated Admin Console function, `portfolio_template:manage_status`, sets a template's
  approval status (the approval mechanism itself — see below).
- The "Stock Portfolio" tab became a "Portfolio" tab with two sub-tabs, **Legacy** and **Flex**
  (`TabShell.tsx`) — each hidden entirely (not just disabled) for a session lacking that
  function's permission, same pattern as Admin/API Keys. A session with neither permission
  falls back to a read-only Legacy view (`DashboardPage`'s new `readOnly` prop — no
  `UploadImportDialog`) rather than a blank tab, the same defensive-default precedent
  `ContrarianFinderPage` already used. **Bug found live and fixed same day**: the Legacy
  sub-tab's `PortfolioSelector` wasn't filtered by `flexTemplateStatus`, so a Flex-created
  portfolio also showed up under Legacy, where its header-alias-guessing importer would have
  silently overwritten data no longer matching the portfolio's bound Flex template —
  `PortfolioSelector` gained an optional `filter` prop, wired from `TabShell` as
  `p => p.flexTemplateStatus === null` for the Legacy sub-tab only.

### Template governance
- Status lifecycle: `Pending Approval` → `Approved` or `Rejected`, changed only via the new
  Admin Console function.
- A user can use *either* an Approved template *or* their own Pending-Approval template for
  their own uploads — pending status only blocks visibility to *other* users, never usage by
  the template's own creator.
- The **Approved-template list a user sees is filtered**, not a flat shared pool: templates
  created by Admin, Admin-Master, or the logged-in user themselves — not every other regular
  user's approved templates. **Open question, not yet resolved**: two different users each
  mapping the same broker end up with two separate private templates rather than converging on
  one shared one — acceptable, or should same-shape mappings eventually get promoted to a
  shared admin-owned one?
- Templates are never deleted, only status-changed — a `Rejected` template has no cleanup story
  and just sits there. Accepted as a "don't over-build" tradeoff, not pushed back on.

### The full creation flow (settled, including the forced-resolution rule)
1. At portfolio creation, pick from the Approved-template list (searchable by name) or a
   personal Pending-Approval dropdown (shown only if the user has one) — **or** start a brand
   new mapping.
2. **New mapping path**: upload a file → map its detected headers (left) to the app's mandatory
   fields — Symbol, Quantity, Current Price — plus optional ones — Purchase Price, Name,
   Sector, Purchase Date (right, mandatory ones visually marked) → **Inspect Data** (disabled
   until every mandatory field is mapped) shows a top-5-record preview, purely in-memory, no
   writes yet.
3. From either path, proceeding **actually creates the portfolio for real** — full file
   imported, `tx_holdings` written, Dashboard rendered from genuinely persisted data (the
   Dashboard can't render any other way, so this was never something that could stay purely a
   preview).
4. **The Dashboard result forces exactly one of two next actions — this is no longer
   optional**:
   - **Looks right** → **Save Template is now mandatory**, not offered-and-skippable. This is
     the entire reason the flow is ordered this way: a template can only ever be saved once
     it's been proven against a real, rendered Dashboard from real data — a superficial top-5
     preview alone can't catch a mapping that's subtly wrong (e.g. a numeric-looking column
     mapped to the wrong field) but would still produce a broken Dashboard. Saving requires a
     meaningful name (validated: trimmed non-empty, minimum length, at least one letter, on top
     of the table's own uniqueness constraint) and persists the mapping into
     `m_portfolio_template_mapping_master`/`_dtls` at `Pending Approval`, binding it to the
     portfolio via `upload_template_id`.
   - **Looks wrong** → the only way out is **Delete Portfolio** (already an existing feature,
     nothing new needed) and start over with a corrected file. Nothing about a bad mapping is
     ever persisted as reusable.
   - **Caveat, acknowledged**: a web app can't literally force a user to stay on a page and
     choose — they can always navigate away mid-decision. "Forced" in practice means: present
     both actions prominently right after the Dashboard renders, and if the user leaves without
     choosing, the portfolio is left in an explicit **error/needs-attention state** (next
     section) rather than silently allowed to exist in limbo.
5. **Later uploads for an existing portfolio**: if it has a bound template, later Flex uploads
   reuse it automatically — no mapping screen shown again. The bound template *can* be changed,
   but changing it always requires re-running Inspect Data against the new mapping first, never
   a silent swap.

### `flex_template_status` — new column on `tx_portfolios`
Tracks exactly the "did this Flex portfolio ever get properly resolved" state from step 4 above
— a deliberately minimal alternative to building a separate notifications/pending-actions
system. Three values:
- **`'Flex'`** — created via Flex and properly closed out. Since the only way to survive a bad
  mapping is deletion, this state can only mean Save Template succeeded — so
  `upload_template_id` is always non-null whenever `flex_template_status = 'Flex'`.
- **`'Flex-Err'`** — created via Flex, but the user left before completing Save Template (or
  Delete). The "needs attention" state — `upload_template_id` stays `NULL` here. Any
  attention-needed banner, and any block on further uploads until resolved, is just
  `WHERE flex_template_status = 'Flex-Err'`.
- **`NULL`** — Classic/Legacy portfolios, untouched by any of this.

Invariant for Flex portfolios: `flex_template_status = 'Flex' ⟺ upload_template_id IS NOT NULL`;
`'Flex-Err' ⟹ upload_template_id IS NULL`. No drift possible between the two columns as long as
both are always written together.

### DB design (table names + column names confirmed by the user)
- **`m_portfolio_template_mapping_master`** — one row per template: `id`, `template_name`
  (`NOT NULL`, unique — backs the search-by-name list), `status` (`'Pending Approval'` \|
  `'Approved'` \| `'Rejected'`), `created_by`/`reviewed_by` (FK → `users`), `reviewed_at`,
  `sample_preview` (`JSONB`, nullable — the top-5-mapped-records snapshot from Inspect Data, so
  an admin reviewing a pending template later doesn't need the file re-uploaded),
  `created_at`/`updated_at`.
- **`m_portfolio_template_mapping_dtls`** — one row per mapped field: `id`, `template_id` (FK
  → master, `ON DELETE CASCADE`), `target_field` (the app's field: `symbol`/`quantity`/
  `currentPrice`/`purchasePrice`/`name`/`sector`/`purchaseDate`), `source_header` (the file's
  actual header text, normalized the same way `mapHeaders()` already does — resilient to column
  reordering on later uploads). Unique on `(template_id, target_field)`.
- **Two new columns on the existing `tx_portfolios`**: `upload_template_id` (nullable FK →
  `m_portfolio_template_mapping_master`, `ON DELETE SET NULL`) and `flex_template_status`
  (nullable `VARCHAR` — `'Flex'` \| `'Flex-Err'` \| `NULL`, per above).
- **No new tables needed for RBAC** (reuses `m_function_master`/`m_role_permissions` — just 3
  new permission rows) **or for holdings data** (Flex just needs to produce the same
  `HoldingEntry[]` shape `parser.service.ts` already does, then plugs into the existing,
  already-tested `portfolioService.importHoldings()` — same `tx_holdings`/`tx_uploads`/
  `tx_portfolio_action_hist` writes as Legacy).

### Implementation summary
- **Backend**: migrations 022-024 (both new tables + `tx_portfolios`' 2 new columns + the 3
  permission rows); `parser.service.ts`'s per-row logic extracted into an exported
  `buildHoldingsFromMappedRows()` (existing `parseGenericCsv` tests passed unchanged — the
  regression proof that Legacy's own output never moved) so `flexParser.service.ts`'s
  `resolveMapping()`/`parseFlexCsv()` reuse the exact same value-parsing code, just with a
  user-defined mapping instead of `HEADER_ALIASES`; `portfolioTemplate.service.ts` (template
  CRUD/governance, including a composable-transaction `createTemplate(input, client?)` so Save
  Template can atomically create-and-bind in one transaction); `portfolio.service.ts` gained
  `createPortfolioFlex()`/`saveFlexTemplate()`/`changeFlexTemplate()`; new
  `POST /portfolios/flex` (supports a `dryRun` preview branch — the wizard's "Inspect Data"
  step — mirroring Legacy's own `dryRun` precedent), `POST`/`PUT /portfolios/:id/flex-template`,
  and the `/portfolio-templates` router (`GET /`, `GET /mine/pending`, `GET /admin/all`,
  `POST /`, `GET /:id`, `PUT /:id/status`). 472 backend tests (up from 467), `tsc`/lint clean.
- **Frontend**: `ColumnMappingWizard` (file → header/field mapping → Inspect Data → top-5
  preview), `FlexTemplatePicker` (searchable Approved list + personal Pending dropdown),
  `FlexResolutionBanner` (the forced Save-Template-or-Delete-Portfolio UI, re-running the
  wizard if the original mapping isn't still in browser session state), `FlexPortfolioPage`
  (the Flex sub-tab — reuses `KpiCards`/`AllocationChart`/`PerformanceChart`/`HoldingsTable`
  unchanged, same as Legacy), and `PortfolioTemplateApprovalPage` (new Admin Console
  "Portfolio Templates" tab, gated by `portfolio_template:manage_status`). 256 frontend tests
  (up from 231), `tsc`/lint clean.
- **Verified live end-to-end** against the real dev server + CockroachDB Cloud instance, all
  cleaned up afterward: brand-new-mapping creation → real Dashboard with real data →
  `flex_template_status: 'Flex-Err'` → Save Template → atomically bound (`Flex` +
  `upload_template_id`, confirmed via direct row query) and appearing in the creator's own
  Pending list; reuse of that still-Pending template by id → resolves immediately to `Flex`;
  changing an already-resolved portfolio's template → re-import + rebind; a plain `user`
  session correctly 403s on `POST /portfolios/flex`; the Admin Console's new Portfolio
  Templates tab lists a Pending template, shows its mapping + sample preview on expand, and
  Approve flips it to `Approved` — immediately visible in a completely unrelated plain user's
  Approved-template list, confirming the full governance loop end-to-end.

## Config Properties framework ✅ Done

Built 2026-08-24, requirements worked out via conversation first (per the "First discuss and
finalize the requirement" instruction), then `/plan`-approved and implemented. General-purpose,
admin-configurable settings so business-tunable values live in the DB and can be changed by
`admin-master` alone, without a code deploy — not a one-off fix, meant to grow (future examples
already named: "Max Portfolios Allowed," "Max Stocks in a Portfolio Allowed"). Deliberately
distinct from `m_function_master`/"Manage Functions" (an unrelated RBAC permission catalog) —
the two were almost named the same thing, caught early in the conversation.

Migration `027` adds `m_config_group` (free-standing category label), `m_config_property` (the
definition — `property_key` globally unique + immutable, `value_type` `'integer'`\|`'string'`,
optional numeric `min_value`/`max_value`, `status` `'active'`\|`'inactive'`), and
`m_config_property_value` (**append-only value history** — every change inserts a new row and
flips the previous active row's `is_active` to `false`, transactionally, same shape as
`roles.service.ts`'s `setUserRole()`; `effective_timestamp` always equals `created_at` for now —
kept as its own column so real future-dated scheduling can be added later with zero schema
change). A property can never exist with zero value rows. Reads are always live, no caching
(`getConfigValue`/`getConfigInt` — the latter never throws, warns + falls back on a
missing/unparseable value). Full detail (including the DB design) in `Architecture.md`
Section 1; new tables documented in `backend/src/db/SCHEMA.md`; user-facing walkthrough in
`User Manual.md`.

**One deliberate exception to "never hardcode a role name"**: `config_properties:manage` can
only ever be granted to `admin-master` — enforced by a small hardcoded
`ADMIN_MASTER_ONLY_PERMISSIONS` set inside `roles.service.ts`'s `grantPermission()`, confirmed
with the user as acceptable since this is genuinely system-level config. The permission
mechanism itself stays fully DB-driven (still a real, revocable `m_role_permissions` row, still
checked by `requirePermission` like everything else) — only *which role this one key can be
granted to* is hardcoded.

**First real consumer wired up**: `contrarianFinder.service.ts`'s previously-hardcoded
`ADMIN_HISTORY_LIMIT = 60` (admin-tier scan history retention) now reads
`contrarian_finder_admin_history_retention_count` via `getConfigInt()`, falling back to `60` if
the config row is ever missing/unparseable.

Backend: `configProperty.service.ts`/`.controller.ts`/`.routes.ts`, every route gated by
`requirePermission('config_properties:manage')`. 53 new backend tests plus the
`contrarianFinder.service.test.ts` admin-tier test updated for the new 3rd `pool.query` call
(542 total), `tsc`/lint clean. Frontend: `api/configProperties.ts` (TanStack Query hooks),
`ConfigPropertiesPage.tsx` (create group/property, edit metadata, set a new value, view version
history) wired into `AdminPage.tsx` as a new admin-master-only tab. 18 new frontend tests (290
total), `tsc`/lint clean. Migration verified live (`SHOW CREATE TABLE` + seeded rows), and
`config_properties:manage` granted to `admin-master` directly (same manual-grant precedent as
`contrarian_finder:scan_history`).

**Second real consumer, migration `029`**: the Admin-Master Fallback API Key model's previously
hardcoded `FALLBACK_ELIGIBLE_ROLES` array (which roles may fall back to the shared admin-master
FMP/Finnhub key when they have none of their own) is now a `string`-typed config property,
`api_key_fallback_eligible_roles` (comma-separated role names, group "API Key Access Policies"),
read live via a new `getConfigStringList()` — no caching, same as the integer consumer above.
**What actually surfaced this**, per the migration's own note: a new custom role, `user-premium`,
had no FMP/Finnhub key of its own and wasn't in the hardcoded array — every key-dependent feature
hard-503'd for it with no way to fix that short of a code deploy, exactly the "business-tunable
value that shouldn't need a deploy" case this framework exists for. New `ROLE_LIST_PROPERTY_KEYS`
validation in `configProperty.service.ts` so a `string`-typed property still gets real validation
(`validateRoleListValue()` — every comma-separated entry, trimmed, must name a role that actually
exists in `m_roles`) instead of being accepted as an arbitrary opaque string; `getConfigStringList()`
trims and drops empty entries the same way on the read side. `getDecryptedKey()`'s role-fetch and
config-read now run concurrently via `Promise.all` rather than adding a second sequential
round-trip.

## Portfolio Upload — Flex: Footer & Cash Row Markers ✅ Done

Built 2026-08-25–27 — two follow-on rounds to the original Flex wizard (above), both addressing
real files the user tried mid-testing that didn't fit the original "one clean header row, then
straight data" assumption.

**Footer marker (migration `028`)**: some broker exports have a trailing summary/disclaimer block
below the real holdings rows (e.g. "Totals," "As of [date]," legal boilerplate) that the parser
had no way to exclude — it would either choke on non-numeric cells in that block or, worse, ingest
it as a bogus holding row. New optional step in `ColumnMappingWizard.tsx`: after Inspect Data's
top-5 preview, the user can click a row in a full-file grid to mark it (and everything below) as
the footer; `flexParser.service.ts` truncates before parsing. Persisted as a nullable
`footer_marker_row` on `m_portfolio_template_mapping_master` so a reused template auto-truncates
future uploads at the same relative row without re-asking. **Real bug found+fixed live**: manually
retyping a value into a cell (to fix a bad parse) didn't reach the same code path as a genuine
file re-upload, so the footer-marker index could silently point past the edited row count —
fixed by re-deriving the marker against the current in-memory row array on every edit, not the
original upload's row count.

**Cash row identifier v1 (migration `030`)**: several brokers export a portfolio's cash/money-
market position as its own row rather than a separate `tx_cash_positions` field the mapping can
target directly — without a way to flag it, that row either got silently dropped (no `Quantity`/
`Current Price` combination made sense for it) or, worse, miscounted into holdings math. V1 added
one pattern only: click a row to mark it "this is the cash row," then map which column holds its
dollar value (a `cashValueColumn` marker, mirroring the footer marker's click-to-set UX) — covers
brokers with cash broken out as its own explicit line with a value column.

**Cash row identifier v2 — JSON redesign (migration `031`)**: testing surfaced a second real
pattern v1 couldn't express — some exports embed the cash amount *inside* a labelled cell
(e.g. a "Description" column containing literal text like `"CASH & CASH EQUIVALENTS $12,345.67"`)
rather than a clean separate numeric column. Rather than bolt on more flat columns, replaced the
3 flat cash columns on `m_portfolio_template_mapping_master` with a single `cash_config JSONB`
column holding a discriminated union:
```ts
type CashValueSource = { kind: 'column'; column: string } | { kind: 'embedded'; pattern: string };
type CashConfig = { rowMarker: string; value: CashValueSource } | null;
```
new `extractEmbeddedCashAmt()`/`coerceCashConfig()` in `flexParser.service.ts` parse the dollar
figure out of the marked cell via the stored pattern. Wizard's cash step now offers "Same column"
(Pattern #1, unchanged UX) vs. "Embedded in another column" (Pattern #2, new) as an explicit
toggle. **Real bug found+fixed live**: switching from Pattern #1 to Pattern #2 left the grid's
click-target defaulted to "marker" instead of auto-switching to "value," so the very next click
(intended to pick the embedded-value cell) silently overwrote the already-correct row marker
instead — fixed by having the "Separate column" step also call `setCashPickTarget('value')` on
entry, and the same day's follow-up bug where the Inspect Data preview never surfaced the detected
cash amount at all — fixed by adding a "Cash detected: $X" line to that step.

Migration `030` and its 3 flat columns never shipped to a real user-facing release before being
superseded by `031` the same week — no backfill/dual-write concern.

## Portfolio Upload — Flex: Guided Stepper ✅ Done

Built 2026-08-26–27 — the wizard had grown, across footer marker + cash identifier v1/v2 above,
into 4-plus loosely-sequenced optional steps before Inspect Data, and manual testing surfaced
users skipping straight to "Use This Mapping" without ever scrolling down to actually look at the
top-5 preview — the one safeguard step 4 of the original flow design depends on ("a template can
only ever be saved once it's been proven against a real, rendered Dashboard" — but that proof is
worthless if the human never looked at the intermediate preview either).

Replaced the flat toggle row with a real 6-step stepper — **Header → Footer → Cash → Map Columns
→ Inspect Data → Confirm Mapping** — rendered as a single combined bar: a left `stageActions` zone
(the step's own Back/Next/Skip buttons, distinct background) and a right stepper zone
(`bg-bg-card`, one indicator per `DISPLAY_STEPS` entry) separated by a visible divider, with a
`stepStatus()` function deriving each indicator's done/current/upcoming state from the wizard's
existing state machine — no new state, purely a derived view.

**Scroll-to-review gate**: "Use This Mapping" stays disabled until the user has actually scrolled
the top-5 preview into view — a `hasSeenPreview` flag flipped by an `IntersectionObserver` watching
a `previewEndRef` sentinel placed after the last preview row, plus a visible remark near the
disabled button explaining why. Once triggered, `hasSeenPreview` stays true even if the user
scrolls back up — the gate only needs to confirm the preview was seen once, not that it's
currently in the viewport.

`ColumnMappingWizard.test.tsx`/`FlexPortfolioPage.test.tsx` needed a `vi.stubGlobal('Intersection
Observer', ...)` mock (jsdom has no real implementation) capturing registered callbacks so tests
can call `simulatePreviewScrolledIntoView()` — wrapped in React Testing Library's `act()` to avoid
act-warnings, since the callback synchronously updates component state outside an event handler.

## Portfolio Template Governance — Delete, Bound-Portfolios & Unattached Portfolios ✅ Done

Built 2026-08-27 — a cluster of admin-side template-lifecycle gaps surfaced while manually testing
the Flex wizard work above, all scoped to the existing Portfolio Templates admin tab (no new menu
items), following the "admin acts on another user's resource, tightly scoped" pattern already
established by this repo's other admin-adjacent features.

**Hard-delete a template**: templates were previously permanent once created ("never deleted, only
status-changed," per the original Flex build) — the user found this too rigid for `Rejected`/still-
`Pending Approval` templates created by mistake during testing. New delete action, restricted to
those two statuses only (an `Approved` template already bound to real portfolios can never be
hard-deleted, only rejected going forward) — blocked outright if any portfolio is currently bound
to it via `upload_template_id`.

**Bound-portfolios pop-up**: rather than a bare "can't delete, in use" error, a blocked delete
attempt now opens a pop-up listing every portfolio still bound to that template (owner email +
portfolio name), each with its own delete action — resolving the block from the same screen
instead of sending the admin off to hunt through Manage Users/Dashboards first. **Real bug found
+fixed live**: deleting a bound portfolio from this pop-up hit the same `useDeletePortfolio` query-
cache race the standalone Dashboard delete flow had already fixed once (see the frontend `client
.ts`/`queryClient.ts` global-401 work below for the general pattern) — the pop-up's own list wasn't
using the fixed `removeQueries`-based hook, so a deleted portfolio could still flash in the list
until the next full refetch. Fixed by wiring the pop-up onto the same shared hook instead of a
bespoke fetch.

**Unattached Flex Portfolios (View + Delete)**: the user found a real orphaned portfolio
("Charles-Schwab - Complete") stuck at `flex_template_status = 'Flex-Err'` — created via Flex, left
before Save Template/Delete Portfolio, with no UI anywhere surfacing that it existed. Per the
user's explicit placement instruction, built as a new section *inside* the existing Portfolio
Templates admin tab, not a standalone menu item. New `listUnattachedFlexPortfolios()`/
`deleteUnattachedFlexPortfolio()` in `portfolio.service.ts` (scoped strictly to
`flex_template_status = 'Flex-Err'` — never touches a resolved `'Flex'` or Legacy portfolio), new
`GET`/`DELETE /portfolio-templates/unattached-portfolios(/:portfolioId)`, gated by the same
`portfolio_template:manage_status` permission as the rest of that tab (no new permission needed —
this is squarely template-governance work). New `UnattachedFlexPortfoliosSection` component in
`PortfolioTemplateApprovalPage.tsx`. Live-verified: the real orphaned Charles-Schwab portfolio
appeared in the list and was cleanly deleted.

## Header Persona Badge ✅ Done

Built 2026-08-27 — a small usability gap noticed while juggling multiple test accounts across
roles during manual QA: the header showed no quick way to confirm which account/role a given
browser session was actually signed in as without opening Admin → Manage Users or squinting at
`/auth/me`. New `UserPersonaBadge.tsx` — an initials-seal badge (`data-testid="user-persona-
badge"`) rendered in both `TabShell.tsx`'s and `AdminPage.tsx`'s headers, with a native `title`
tooltip showing the full email and role(s) on hover (no extra dependency for a custom tooltip).
Small enough to not warrant its own migration or backend change — purely derived from the already-
fetched `useSession()` data.

## Global 401 Self-Healing Session ✅ Done

Built 2026-08-27 — root-caused a recurring "the app looks like the backend is down" report that
turned out to be entirely client-side: `useSession()`'s `staleTime: Infinity` meant that once a
cookie went stale (expiry, or a backend restart invalidating the JWT secret in dev), the frontend
kept trusting its cached "logged in" state and let every subsequent authenticated call fail with an
uncaught 401 instead of ever re-prompting login — surfaced first as a user report asking whether
logging into two different roles from the same browser tab was supported (it isn't — the cookie is
per-origin, not per-tab — but chasing that question surfaced the real underlying bug).

New `frontend/src/lib/queryClient.ts` exports: `SESSION_EXPIRED_STORAGE_KEY` and
`clearSession(client: QueryClient, options: { markExpired?: boolean } = {})` — clears the cached
session/portfolio/etc. query state and, when `markExpired` is set, drops a `sessionStorage` flag
for the next page load to notice. `frontend/src/api/client.ts`'s `apiFetch` now calls
`clearSession(queryClient, { markExpired: true })` on *any* `401` response, from *any* call site,
before throwing — a single global choke point rather than teaching every page its own 401 handler.
`useLogout` reuses the same `clearSession()` (without `markExpired`) for the ordinary logout path.
`LoginPage.tsx` checks/clears the flag on mount and shows a "Your session ended, please log back
in" banner (`data-testid="login-session-expired"`) when it was set.

**Real bug found+fixed during design**: the first version of `clearSession` closed over the
singleton `queryClient` import directly, which broke `useLogout`'s existing test (that test
constructs its own local `QueryClient` instance, never the app singleton) — fixed by making
`clearSession` take the `QueryClient` as an explicit parameter instead of importing the singleton,
so callers (real app code and tests alike) always pass the instance they actually mean.

Also fixed the same day: a `useDeletePortfolio` 404 console error on delete — a blanket
`invalidateQueries(['portfolios'])` was refetching the just-deleted portfolio's own detail query
before the caller's state update could navigate away from it. Switched to
`queryClient.removeQueries({ queryKey: ['portfolios', id] })` for the specific deleted portfolio
plus an `exact`-scoped `invalidateQueries` for the list only — this is the same shared hook later
reused by the bound-portfolios pop-up above.

## "Login-as" Impersonation ✅ Done

Built 2026-08-28, `/plan`-approved after a same-session discussion of the idea ("Heavy Lift or OK
Lift?" — assessed as an OK lift given the existing JWT/RBAC/admin-user-list foundation already in
place). Lets an `admin-master` account view the app exactly as a specific user sees it, without
their password — a non-intrusive troubleshooting tool for the multi-role rollout, not a general
admin feature. Per explicit direction, the permission is deliberately **admin-master-only and
granted via direct SQL only**, never through the Admin Console's Manage Permission screen — same
backend-only rollout precedent as `config_properties:manage`/`contrarian_finder:scan_history`.

**Dual-identity JWT, not a second session**: `auth.service.ts`'s `TokenPayload` gains an optional
`impersonatedBy` (the admin's own user id); `signToken()` takes an `{ impersonatedBy?, expiresIn?
}` option; `requireAuth.ts`/`types/express.d.ts` carry the same optional field onto `req.user`. One
cookie, one token, both identities recoverable from it. Impersonation sessions get a deliberately
shorter expiry (new `env.impersonationExpiresIn`, default `1h` vs. the normal 7d) — when it lapses,
the Global 401 Self-Healing Session work above already handles it gracefully with zero new
plumbing.

**New `impersonation.service.ts`**: `startImpersonation(adminId, targetUserId)` 404s on a
nonexistent target and blocks (403, `CannotImpersonateAdminError`) a target holding *any*
admin-console permission (`roles:manage`/`permissions:manage`/`users:manage_roles`/
`functions:manage` — the same set `hasAdminConsoleAccess` already checks frontend-side, mirrored
backend-side) — impersonating another admin is a privilege-escalation path, not a support tool,
full stop. `endImpersonation(adminId, targetUserId)` stamps `ended_at`. New migration `032`: an
`m_function_master` row for `users:impersonate` (not granted by the migration itself — granted to
`admin-master` via a direct, separate SQL statement), and `user_evt_impersonation_log`
(`admin_user_id`/`target_user_id`/`started_at`/`ended_at` nullable, `WITH (ttl_expire_after = '180
days')` — longer than usage-tracking's own TTLs, since this is a security audit trail).
`roles.service.ts`'s `ADMIN_MASTER_ONLY_PERMISSIONS` set gains `'users:impersonate'`.

**Auth controller**: `POST /auth/impersonate` (`requireAuth` + `requirePermission('users
:impersonate')`) rejects nested impersonation with `409` if `req.user.impersonatedBy` is already
set, otherwise signs a new short-lived token for the target and sets the cookie. `POST /auth/stop-
impersonating` (`requireAuth` only) `400`s if not currently impersonating, otherwise ends the audit
row and signs a fresh normal-length token for the *original* admin. `GET /auth/me` gains
`impersonating: boolean`.

**Frontend**: `User.impersonating`; `switchIdentity(queryClient, user)` helper (`clear()` then a
synchronous `setQueryData` — no clearSession-style deferred race to guard against here, since the
new cookie is already valid the instant this runs, unlike the logout/expiry case). New
`LoginAsModal.tsx` (reuses the existing `useUsersWithRoles()`/`GET /users`, already gated by
`users:manage_roles` — no new list endpoint needed; search/filter, explicit confirm step, surfaces
a failed attempt's backend error inline instead of closing). New `ImpersonationBanner.tsx`
(`data-testid="impersonation-banner"`, rendered in both `TabShell.tsx` and `AdminPage.tsx` — "You
are viewing as {email}." plus a "Return to my account" button, `data-testid="return-to-my-
account"`). `AdminPage.tsx` gains a "Login as User" header trigger, hidden entirely without
`users:impersonate`, same permission-gating pattern as every other admin-console control.

New `impersonation.service.test.ts` (4 tests), extended `auth.controller.test.ts` (`/auth
/impersonate`/`/auth/stop-impersonating` blocks, updated `/auth/me` test), new `LoginAsModal
.test.tsx` (4 tests), new `ImpersonationBanner.test.tsx` (3 tests), extended `AdminPage.test.tsx`
(2 new tests for the header trigger's permission gating), `UserPersonaBadge.test.tsx` fixed for the
new `impersonating` field on the test `User` fixture. `tsc`/lint clean both sides. **Known gap,
not yet closed**: full live verification with two real accounts (banner correctness against a real
target's real data, clean return-to-admin, blocked same-admin impersonation, and the audit row's
`ended_at` populating on return) is still pending — see Next Up.

## Next Up

- **Login-as live verification** — impersonate a plain user with two real accounts and confirm the
  banner/Dashboard reflect the target's real data, "Return to my account" restores admin-master
  cleanly, impersonating another admin/admin-master is blocked, and the audit row in
  `user_evt_impersonation_log` gets a non-null `ended_at` after returning.

- **Usage Tracking** (the unfinished part of the RBAC item above) — extend per-feature usage
  logging beyond Contrarian Finder scans, toward future subscription tiering.
- Two small known-leftover cleanups (harmless, not yet decided): an orphaned
  `apiKeys:bringMyOwn` permission naming inconsistency (`User Manual.md`); `momentum
  .service.ts`'s dead-but-undeleted functions, kept as the Python extraction's rollback path.
- Phase 4: Shared quote cache — **⏸ on hold, deferred by the user 2026-07-29**. Design already
  settled (CockroachDB TTL table over Redis, UPSERT-keyed by symbol, TTL window = the
  retention rule) — see `Architecture.md` Section 3 item 8. Table naming (doesn't fit
  `m_`/`tx_`/`sys_`/unprefixed/`user_evt_`) is the one still-open decision.
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
