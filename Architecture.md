## Rebuild Plan — From Single-User Client-Side App to a Scalable Multi-User Platform

**Last updated:** 2026-08-07

**Why this section exists:** the user identified the single biggest shortcoming of the current app: it's a 100% client-side, single-user project (no backend, no database, no auth — `localStorage` is the only persistence layer) and therefore cannot scale beyond "one person, one browser." This doc started as a forward-looking rebuild plan and has since become a **living status document** — Section 1 tracks what's actually built, Section 2 is the immediate next action, Section 3 is the full ordered backlog. Update it as work lands rather than letting it drift back into a stale one-time plan. For a compact, fast-scan version of Section 1, see `CLAUDE.md`'s "Current Build State" — this doc carries the detail and rationale; that one carries the quick summary.

This is this repo's own copy — the source repo (`../CreateStockPortfolioViewWOSkill`) has a separate `Architecture.md` describing the plan from that app's perspective. Only this copy is kept in sync with actual backend work.

### Current Shortcomings → Remediation in New Build

| # | Shortcoming (today) | Why it matters | Remediation in the rebuild | Addressed in |
|---|---|---|---|---|
| 1 | No backend — pure static HTML/JS | Zero compute layer to enforce business logic, quotas, or security server-side | Node.js/Express backend API owning all business logic, validation, and third-party calls | Phase 1 |
| 2 | No database — `localStorage` only | Data is trapped on one browser/device; cleared cache = data loss; no backup, no history | CockroachDB Cloud with `users`/`tx_portfolios`/`tx_holdings`/`tx_cash_positions`/`tx_uploads` tables as the single source of truth | Phase 1 |
| 3 | No user accounts / auth | The app has no concept of "a user" — can't support more than one person without data collision | Real authentication (JWT or managed provider); every row in the DB scoped by `user_id` | Phase 2 |
| 4 | FMP/Finnhub API keys stored in browser `localStorage` | Visible in DevTools to anyone with access to the machine; every user must obtain and pay for their own key; no key rotation or centralized quota control | Keys live in backend environment variables only; frontend never sees them; backend is the single billable, rate-limited caller | Phase 1 |
| 5 | Every browser tab calls third-party APIs directly | No shared caching — 10 users looking at AAPL trigger 10 redundant paid API calls instead of 1 | Shared quote cache (Redis or a TTL table) behind the `GET /quotes` backend proxy | Phase 4 |
| 6 | No multi-device sync | Upload a portfolio on a laptop, it's invisible on a phone | Portfolio data lives in the DB, not `localStorage` — any device, same login, same data | Phase 2–3 |
| 7 | No server-side validation | CSV/Excel/TXT parsing happens entirely in-browser; a malformed or hostile file is only ever checked client-side | Re-run/validate parsing server-side on upload before persisting, in addition to existing client-side checks | Phase 1/backlog |
| 8 | No observability | No logs, error tracking, or usage metrics beyond what's visible in one person's browser console | Structured backend logging + error tracking (e.g. Sentry) + DB-backed usage/scan history | Phase 5 |
| 9 | No CI/CD, no automated tests | Every change is manually verified rather than a repeatable pipeline | GitHub Actions pipeline: lint + unit tests + integration tests on every PR | Phase 0 & 5 |
| 10 | No environment separation | There's no staging vs. production — `index.html` *is* the production app | Separate staging/production deploys and databases, promoted via the CI/CD pipeline | Phase 5 |
| 11 | UI not designed for multiple form factors | App is unusable/cramped on tablet or mobile; a growing multi-user base will include non-desktop users | Rebuild frontend layout with responsive breakpoints (mobile-first per component) | Phase 3 |

### Target Architecture

```
┌──────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Frontend    │◄────►│  Backend API       │◄────►│  CockroachDB Cloud│
│  (SPA/CDN)   │ HTTPS│  (Node.js/Express) │      │  (m_/tx_/sys_)    │
└──────────────┘      │  - Auth (JWT)      │      └──────────────────┘
                       │  - Portfolio CRUD  │
                       │  - Quote proxy     │      ┌──────────────────┐
                       │  - Rate limiting   │◄────►│  Redis / cache    │
                       └─────────┬──────────┘      │  (shared quotes)  │
                                 │
                                 ├──────────────────────────┐
                                 ▼                          ▼
                       ┌───────────────────┐      ┌──────────────────────┐
                       │ FMP / Finnhub APIs │      │ Python analysis      │
                       └───────────────────┘      │ microservices (later)│
                        (keys live ONLY here,      │ Momentum/Contrarian/ │
                         never sent to browser)     │ Long-Term Analysis   │
                                                    └──────────────────────┘
```

Key shifts from today:
- **Backend owns all third-party API calls.** FMP/Finnhub keys live in backend environment variables; the frontend never sees them. The backend is the single rate-limited, billable caller — and can share one cached quote across every logged-in user.
- **Database owns all portfolio data.** `users`, `tx_portfolios`, `tx_holdings`, `tx_uploads`, `tx_cash_positions` tables replace `localStorage['pf-data']`/`['pf-cash']`. Data survives across devices and browser sessions.
- **Auth scopes everything.** Every API call is tied to a `user_id`; no more shared-browser data collisions.
- **Frontend becomes a thin client.** It calls the backend's REST API instead of FMP/Finnhub directly and instead of reading/writing `localStorage` for anything beyond a short-lived offline cache.
- **Node stays the single API gateway even after Python enters the picture.** The frontend and any other future consumer only ever talk to Node/Express; Momentum/Contrarian/Long-Term analysis eventually move behind it into Python microservices (see Section 3), but that's an internal implementation detail the gateway hides — the external contract doesn't change.

---

## Section 1 — Accomplished Till 08-14

### Phase 0 — Foundations ✅ Done
- `backend/`/`frontend/` split; `frontend/index.html` is still a placeholder.
- `.github/workflows/ci.yml` — lint + test on push/PR, Node 20.

### Phase 1 — Backend API & Data Model ✅ Done

**Database platform & schema:**
- CockroachDB Cloud provisioned (superseded an earlier Aiven PostgreSQL decision — no Aiven references remain anywhere in this repo).
- 10 migrations applied live against the `stockPortfolioAnalysis` database: `001`–`005` created the core tables (`users`, `portfolios`, `holdings`, `cash_positions`, `uploads`), `006`–`008` created the reference tables (`tickers`, `index_master`, `index_constituent`), `009` renamed the 3 reference tables with an `m_` prefix, `010` renamed the 4 portfolio-scoped tables with a `tx_` prefix.
- Table naming convention settled: `m_` (master/reference data), `tx_` (transactional, portfolio-scoped), `sys_` (internal bookkeeping — `sys_schema_migrations`, renamed from `schema_migrations` via a one-off manual step since it's the table the migration runner itself depends on), `users` unprefixed (deliberately excluded from `tx_` — it's the account root, not portfolio-scoped data).
- `backend/src/db/pool.js` — CockroachDB connection pool (SSL handled automatically via `sslmode=verify-full` in the connection string; no separate CA cert needed).
- `backend/src/db/migrate.js` — idempotent migration runner (`npm run migrate`), tracks applied files in `sys_schema_migrations`.
- `backend/src/db/seedTickerData.js` — idempotent seed script (`npm run seed:tickers`) porting the existing hardcoded reference data into `m_tickers` (218 rows), `m_index_master` (14 rows), `m_index_constituent` (538 rows).
- `backend/src/db/SCHEMA.md` — full live schema documentation, including the naming convention and CockroachDB-specific quirks (non-sequential IDs from `unique_rowid()`, constraint names not following table renames).

**Services & endpoints:**
- Services ported from the source app: `parser.service.js`, `momentum.service.js`, `contrarianFinder.service.js`, `livePrices.service.js`, `marketData.service.js` — each with a matching Jest test file. Synced 2026-07-08 against source-app drift (Kelly-sizing score-gating fix, unified `fmpGet` timeout/error handling, static-only universe assembly, configurable `scanDays`, the "Strength List" screen).
- `contrarianFinder.service.js`'s `assembleUniverse()` converted from a sync function reading a hardcoded JS module to an **async function querying `m_index_constituent` live** — a platform-only enhancement with no equivalent in the source app.
- REST endpoints built: `GET /quotes`, `POST /contrarian-finder/scan`.
- Rate limiting middleware (`src/middleware/rateLimit.js`) wraps both endpoints.
- FMP/Finnhub keys live only in `backend/.env` / `src/config/env.js` — never sent to the frontend.
- Test suite: 58 Jest tests passing, lint clean. Verified against the live DB directly (not just mocks) at each major step.

**Backend migrated to TypeScript — 2026-07-11.** All 21 `src/` files and 6 test files
converted (`strict: true`); the `.js` filenames in the bullets above are historical — every
file listed is now `.ts`. New tooling: `tsconfig.json`/`tsconfig.jest.json`, `ts-jest`,
`ts-node`/`ts-node-dev` (replacing `nodemon`), `typescript-eslint`. `npm run build` compiles
to `dist/`; `npm start` runs the compiled output; `dev`/`migrate`/`seed:tickers` run straight
off `.ts` via `ts-node`. Verified: `tsc --noEmit` clean, all 58 tests still passing with zero
behavior change, lint clean, `npm run migrate` and a live `assembleUniverse()` smoke test
both re-confirmed against the real DB post-migration (348-symbol universe, unchanged).
Two incidental fixes made while converting (not scope creep — both were direct consequences
of adding types): `tests/app.test.ts` now mocks `../src/db/pool` (the original never did,
which would have crashed the suite in CI — see next bullet — since `pool.ts` throws without
`DATABASE_URL`); `quotes.controller.ts` now returns a clean 400 instead of crashing on an
array-valued `?symbols=` query param.

**CI pipeline fixed — 2026-07-11.** `.github/workflows/ci.yml` triggered on `branches: [main]`
since Phase 0, but this repo's actual default branch is `master` — the workflow had never
once fired on any push or PR. Fixed to `branches: [master]`, and a `npm run typecheck` step
(`tsc --noEmit`) was added alongside the existing lint/test steps. **Confirmed live** on the
very next push — GitHub Actions run #1, `success`, ~30s (typecheck + lint + test all passed
in a clean environment with no local `.env`, which is exactly what the `app.test.ts` pool-
mock fix above was protecting against).

**Auth: signup/login/logout built — 2026-07-12.** Roll-your-own bcrypt + JWT in an httpOnly
cookie (both confirmed with the user; see the auth-decision plan). No new migration needed —
`users.password_hash` already existed from Phase 1 schema design. New: `auth.service.ts`
(`hashPassword`/`verifyPassword`/`signToken`/`verifyToken`/`createUser`/`findUserByEmail`/
`login`, plus `EmailAlreadyExistsError`/`InvalidCredentialsError`), `requireAuth.ts`
middleware (populates `req.user`, now properly typed via a new `src/types/express.d.ts`
global augmentation — replacing the inline cast `rateLimit.ts` used to need), `auth
.controller.ts` + `auth.routes.ts` (`POST /auth/signup|login|logout`), wired into `app.ts`
with `cookie-parser` and `cors({ credentials: true, origin: env.frontendOrigin })` (new env
vars: `JWT_EXPIRES_IN`, `FRONTEND_ORIGIN`, `NODE_ENV`; `JWT_EXPIRES_IN_MS` is derived from
`JWT_EXPIRES_IN` via the `ms` package rather than configured separately, so the JWT
lifetime and the cookie's `maxAge` can't drift apart). Login returns the identical error
message for "unknown email" and "wrong password" (no user-enumeration leak) — deliberately
centralized in `auth.service.ts`'s `login()`, not left to the controller. 21 new tests (79
total). Verified live against the real CockroachDB instance via the actual dev server
(`npm run dev` + `curl`): signup → duplicate-email 409 → wrong-password 401 → login sets a
real HttpOnly JWT cookie → logout clears it with an expired date — then the smoke-test
accounts were deleted from the real `users` table. `requireAuth.ts` itself was also
exercised directly (valid/missing/garbage token) since no protected route exists yet to
test it through HTTP — that's the next item.

**Portfolio CRUD + CSV import + live-price refresh + buy/sell history — 2026-07-12.**
`GET/POST/PUT/DELETE /portfolios`, `POST /portfolios/:id/import`,
`POST /portfolios/:id/refresh-prices` — all behind `requireAuth`, all scoped by `user_id`
(a `null`/not-owned lookup 404s either way, same user-enumeration-safety principle as
login). 2 new migrations: `011` adds `tx_holdings.price_updated_at` (per-holding, not
per-portfolio — see below), `012` creates `tx_portfolio_action_hist`. New
`portfolio.service.ts`/`portfolio.controller.ts`/`portfolio.routes.ts`.
- **Import reuses `parser.service.ts` as-is** (JSON body `{ filename, content }`, not
  multipart — no `multer` dependency needed before a frontend exists to actually send a
  real file upload). Re-import **replaces all holdings** inside a DB transaction
  (`pool.connect()`/`BEGIN`/`COMMIT`/`ROLLBACK` — new pattern for this codebase, everywhere
  else used single independent `pool.query` calls) — this is the backend endpoint's
  unconditional contract; a future UI is expected to confirm with the user before ever
  calling it (see Section 3 item 2's frontend note).
- **Buy/sell diffing**: every import diffs old vs. new holdings per symbol
  (`delta = newQty − oldQty`; `delta > 0` → `BUY` row in `tx_portfolio_action_hist`,
  `delta < 0` → `SELL`, `delta === 0` → no row) — not just brand-new/fully-closed positions,
  partial quantity changes too. A symbol dropped entirely still gets logged, falling back
  to its last-known price since the new import has no price for it anymore.
- **`price_updated_at` is per-holding, not per-portfolio** (caught during plan review,
  before any code was written): `marketData.getQuotes()` tolerates partial per-symbol
  failures, and `livePrices.service.ts`'s `applyLivePrices()` only updates holdings that
  got a match — a single portfolio-level timestamp would falsely claim every holding was
  fresh even when some weren't.
- 34 new tests (113 total) — heaviest coverage on the diff logic (new/closed/partial-
  increase/partial-decrease/unchanged, each independently verified). Verified live against
  the real DB via the actual dev server, reusing the `demo-user@example.test` account:
  created a portfolio, imported a CSV (AAPL 10 + MSFT 5 → 2 `BUY` rows), imported a second
  CSV (AAPL 15, GOOGL 3, no MSFT) and confirmed the exact 3 resulting action-hist rows
  directly in the DB (`AAPL BUY +5`, `GOOGL BUY +3`, `MSFT SELL -5 @ its last price`),
  confirmed `refresh-prices` correctly 503s without a configured `FMP_API_KEY` (this repo
  has never had a real key set — all FMP-touching tests already mock `fetch` for exactly
  this reason), deleted the portfolio and confirmed cascade cleanup across all 4 child
  tables directly in the DB.

**User-owned API keys: `users_subscriptions` table — 2026-07-12.** User picked **Option
A** for the API-key model (bring-your-own key, not a shared pooled key) — see below.
Unprefixed table (grouped with `users`, not `tx_`, since it's account-level not portfolio-
scoped), one row per `(user, provider)` so adding a future provider beyond FMP/Finnhub is a
zero-schema-change allowlist edit. Migration `013`. New
`src/utils/encryption.ts` — AES-256-GCM via Node's built-in `crypto`, **no new npm
dependency** — encrypts every key before it touches the DB; `api_key_encrypted` stores
`iv:authTag:ciphertext` (hex, colon-delimited). New env var `API_KEY_ENCRYPTION_KEY`
(32-byte, separate from `JWT_SECRET` — a secret shouldn't do double duty), validated
eagerly at module load matching `pool.ts`'s fail-fast pattern for `DATABASE_URL`.
`userSubscription.service.ts`/`.controller.ts`/`.routes.ts` — `GET/PUT/DELETE
/subscriptions`, behind `requireAuth`. **The raw key is never returned in any response** —
`GET`/`PUT` responses only ever include a masked value (`••••••••` + last 4 chars); `list
Subscriptions()` decrypts server-side only long enough to compute that mask. 13 new tests
(126 total). Verified live: added a real key, confirmed the DB column holds genuine
ciphertext (not plaintext, decrypts back correctly), confirmed masked-only responses,
updated the same provider in place (row count stayed at 1 — the `UNIQUE (user_id,
provider)` upsert works), deleted it, confirmed a second delete correctly 404s.
**Scope boundary, explicit:** this only builds key *storage* — `quotes.controller.ts`/
`contrarianFinder.controller.ts`/`portfolio.controller.ts`'s refresh-prices still call FMP
using the global `env.fmpApiKey`, not a per-user key yet. That rewiring is now Section 2's
next step, kept separate since it touches multiple existing services' call signatures.
Also noticed live: `node-pg` returns `DATE` columns as JS `Date` objects with a
local-midnight timezone quirk (`renewal_date` of `2027-01-01` round-tripped as
`2027-01-01T05:00:00.000Z`) — cosmetic only since this field is informational/unenforced,
but worth knowing if a future frontend renders it naively.

### Phase 2 — Auth & Multi-Tenancy ✅ Done
Auth (signup/login/logout), per-request `user_id` scoping (portfolio CRUD), the user
API-key model decision (Option A, bring-your-own, storage built above), and per-user keys
now actually wired into every FMP call site (below) are all resolved.

**Per-user FMP keys wired into the actual call sites — 2026-07-12.** `users_subscriptions`
storage existed but nothing read from it; now `GET /quotes`, `POST /contrarian-finder/scan`,
and `portfolio.service.ts`'s `refreshPrices` all resolve and decrypt the *calling user's own*
FMP key instead of the global `env.fmpApiKey`. Confirmed during planning: **Finnhub still has
zero real implementation anywhere** (only config vars + an allowlist entry) — this pass is
FMP-only in practice, there's no Finnhub-consuming code to wire a key into.
- New `userSubscription.service.ts` export: `getDecryptedKey(userId, provider)` (throws a new
  `MissingUserApiKeyError` if no row exists for that user/provider) and the
  `MissingUserApiKeyError` class itself.
- `marketData.service.ts`'s `getQuotes`/`getHistorical` now take an explicit `apiKey` param
  instead of reading one internally — `requireFmpKey()`/`MissingApiKeyError` deleted (zero
  remaining callers, confirmed via grep). `env.fmpApiKey`/`FMP_API_KEY` itself stays (still
  useful for ops/seed-script purposes), only the dead read-it-internally function is gone.
- **Breaking change, intentional:** `GET /quotes` and `POST /contrarian-finder/scan` are now
  `requireAuth`-gated — previously anonymous/public endpoints. This is the direct consequence
  of bring-your-own-key: an anonymous caller has no key to resolve. No real external consumers
  exist yet (no frontend), so blast radius was just the test suite.
- **No fallback to the global key.** An authenticated user with no FMP key on file gets a
  clear `503 { error: "No fmp API key on file. Add one via PUT /subscriptions/fmp." }` from
  all three surfaces — never a silent fallback to `env.fmpApiKey`.
- 3 test files updated (`portfolio.service.test.ts`, `portfolio.controller.test.ts`,
  `app.test.ts`) — each partial-mocks `userSubscription.service` (`jest.requireActual(...)`
  spread + only `getDecryptedKey` replaced) rather than full-automocking the module, so the
  real `MissingUserApiKeyError` class survives for `instanceof` checks in tests. 130 tests
  passing (up from 126), `tsc --noEmit` clean on both configs, lint clean (0 errors).
- Verified live against the real CockroachDB instance via the actual dev server: signed up a
  throwaway user, confirmed `GET /quotes`/`POST /contrarian-finder/scan` 401 with no cookie,
  503 with a valid cookie but no FMP key, added a real (fake-value) key via
  `PUT /subscriptions/fmp`, then confirmed both endpoints got *past* the 503 — `/quotes`
  reached real FMP and got back "Invalid or expired FMP API key" (expected, no real key
  available in this environment), `/contrarian-finder/scan` completed a full 348-symbol scan
  (per-symbol FMP failures are already tolerated by `contrarianFinder.service.ts`, so an
  invalid key there degrades to zero candidates rather than an error). Throwaway user deleted
  afterward, confirmed `users_subscriptions` cascade-deleted with it.

### Phase 3 — React frontend ✅ Done

**Scaffold (2026-07-13):** Vite + React + TypeScript in `frontend/` (first real code there —
was a single placeholder `index.html`). **Tailwind v4**, not v3 as originally planned — npm
resolved the current major version, which moved config from `tailwind.config.ts` to a
CSS-first `@theme` block; source app's design tokens (`css/styles.css`'s `:root`/
`[data-theme="dark"]` custom properties) ported directly into `src/index.css`'s `@theme`,
so `[data-theme="dark"]` still flips every color via cascading CSS vars, same mechanism as
the source app. React Router (pages, not modals, for every major surface — matches the
source app's separate-page pattern more than a SPA-modal pattern would), TanStack Query
(server state + the attempt-and-catch-401 session check — no dedicated `GET /auth/me`
endpoint needed), Chart.js via `react-chartjs-2` (reuses the source app's chart configs
conceptually). Vitest + React Testing Library, mirroring the backend's Jest discipline.

**2 new backend endpoints**, both following the exact `requireAuth` +
`userSubscription.getDecryptedKey(userId,'fmp')` + 503-on-missing-key pattern already
established:
- **`GET /momentum/:symbol`** — `momentum.service.ts` gained `assembleMomentumAnalysis()`,
  completing the port its own header comment had flagged as pending (volume ratio, entry/
  stop/target/R:R, 5-part 0-10 scoring, signal classification, flags/extras), ported from the
  source app's `analyzeMomentum()`. `calcKellySizing()` stays a call the **frontend** makes
  client-side (capital is a live-editable input, no reason to round-trip on every keystroke).
- **`GET /stock-preview/:symbol`** — thin proxy (`marketData.getQuotes`+`getHistorical`), the
  trivial 8-window period-return math stays client-side. Uncovered a real gap while building
  this: `marketData.service.ts`'s `Quote` type had no `isActivelyTrading` field (needed to
  decide the chart's live-vs-last-close rightmost point) — added to `getQuotes()`'s mapping,
  additive/non-breaking, no consumer needed updating.

**6 pages/widgets shipped:** Login/Signup, Dashboard (portfolio selector/create, CSV/TXT
import with the required replace-confirmation, KPI cards, allocation + gain/loss charts,
`refresh-prices`, responsive Holdings table), Subscriptions (add/update/delete the FMP key;
notes Finnhub is storable but unused by any feature), Contrarian Finder (scan controls +
responsive results table), Momentum (ticker lookup, score breakdown, trade setup, client-side
Kelly sizing), Stock Preview Chart (modal, triggered by clicking a symbol in either table).

**Deferred, per an explicit scope decision during planning** (checked each unbuilt page's
actual complexity before committing to scope, not assumed): Long-Term Analysis (already
backlog, no existing implementation anywhere) and **Contrarian Comeback Analysis** — the
full `contrarian-analysis.html` detail page (distinct from the small Stock Preview Chart
widget) turned out to have ~500+ lines of real logic with zero backend equivalent (weekly
RSI/OBV built from scratch, Fibonacci levels, a 5-factor weighted scoring model,
fundamental-ratio thresholds, staged entry/stop math, a stateful gate-check workflow) —
comparable in size to Long-Term Analysis, not a quick port. Both are now Section 3 backlog
items (below).

**Responsive-design fix (shortcoming #11), the actual point of this phase:** both the
Holdings table and the Contrarian Finder results table render as stacked cards below `md`
instead of the source app's horizontal-scroll-only tables — verified via component tests
asserting both markups exist simultaneously (Tailwind's `md:hidden`/`hidden md:block` just
toggle visibility) and via the user's own manual browser walkthrough.

**3 real bugs found during that manual walkthrough, all fixed same day:**
1. Holdings table didn't switch to card view on first resize (only after navigating away and
   back) — root cause was `AllocationChart`/`PerformanceChart`'s Chart.js canvases having no
   explicit height-constrained parent, so they held onto a desktop-measured width and pushed
   the whole page into horizontal scroll until something forced a remount. Fixed: wrapped
   both charts in a fixed-height (`h-64`) container + `maintainAspectRatio: false` (a pattern
   already correctly used by `StockPreviewChart` but missed on the dashboard). Contrarian
   Finder's results table, which has no charts above it, switched correctly on the very first
   try — the differential symptom that pointed at Chart.js rather than the table CSS itself.
2. Momentum page showed only the total score, not its breakdown — added a "Score Breakdown"
   card (RSI/MACD/Volume/Trend/R:R, each 0-2 with a mini progress bar).
3. Contrarian Finder's scan (batches against ~348 symbols with a ~60s wait between batches,
   so genuinely 1-3 minutes) showed a bare "Scanning…" with zero feedback — added a spinner +
   elapsed-second counter + explanatory text (no real progress bar, since the API is a single
   synchronous response, not a polled job — that would be a separate, larger feature).

**Import preview ("Proceed w/o Replace") — built 2026-07-13, a follow-up feature request**
after Phase 3 landed: the replace-confirmation modal only offered Cancel/Replace. Added a
third option that parses the newly-picked file and shows the result **without writing
anything** — confirmed live via direct DB row-count checks (`tx_holdings`/`tx_uploads`/
`tx_portfolio_action_hist` counts identical before/after). Backend: `POST
/portfolios/:id/import` gained a `dryRun: true` early-return branch that calls the already-
pure `parseFile()` and returns before ever reaching `portfolioService.importHoldings` — no
new route, since parsing has no portfolio context to scope by `:id` in the first place.
Frontend: a new `/portfolios/:id/import-preview` page (not a modal, matching the rest of
Phase 3's page-not-dialog pattern) reached via React Router navigation state, showing an
"⚠ Unsaved" banner, the parsed holdings (reusing `HoldingsTable` via a small adapter, keeping
the responsive card/table behavior rather than a second table), and — a first — the parser's
per-row `errors` array, which existed all along in `tx_uploads.errors` but was never
surfaced to any user before. Import Now / Discard actions.

**Test counts**: backend 153 Jest tests (up from 130 pre-Phase-3), frontend 22
Vitest tests (0 before, since `frontend/` had no code). Both sides: `tsc`/`vite build`/lint
clean throughout.

**Verification caveat, worth knowing**: this session's browser-automation tool could not
reach `localhost` on this machine (confirmed: a real external site loaded fine, `localhost`/
`127.0.0.1` on the dev-server ports both showed as an error page — an environment network
boundary, not an app bug). Automated tests, full curl-based API walkthroughs, and direct
DB row-count checks were used throughout instead; the actual visual/responsive/mobile-viewport
walkthrough was done by the user directly in their own browser, which is what surfaced the
3 bugs above.

### Python service scaffolding — analysis-service ✅ Done

**Built 2026-07-24.** First Python code and first Docker artifact in this repo. New
`analysis-service/` (fourth sibling to `backend/`/`frontend/`/`e2e/`, its own independent
project): FastAPI app (`app/main.py`) exposing `GET /health` via a Pydantic `HealthResponse`
model — using `response_model` even for one field deliberately, to establish the
Pydantic/OpenAPI pattern before real analysis logic (Section 3 items 2-3) needs it.
Dependency management via **Poetry** (`pyproject.toml`/`poetry.lock`, `package-mode = false`
since this is an application, not an installable library) — first use of Poetry in this repo,
chosen over plain `requirements.txt` for its dependency locking. `pytest` via FastAPI's
`TestClient`, zero external dependencies (no DB, no live Node). `Dockerfile`: single-stage
`python:3.12-slim`, Poetry installed in-image with `virtualenvs.create false` (installs
straight into system site-packages, standard practice for Dockerized Poetry apps), non-root
`appuser`, `uvicorn` as the run command.

**Node-side proxy**, following the existing `stockPreview.controller.ts` thin-proxy shape
exactly: new `backend/src/services/analysisService.ts` (`checkHealth()` — a small
purpose-built `fetch`-with-timeout wrapper, deliberately NOT copying `marketData.service.ts`'s
`fmpGet` FMP-specific quirks like 402-as-no-data, since there's nothing FMP-shaped to
distinguish when talking to an internal same-infra service), `analysis.controller.ts`,
`analysis.routes.ts`, wired into `app.ts` as `GET /analysis/health`. **Decision**: this route
is `requireAuth`-gated, consistent with every other proxied route (`/stock-preview`,
`/momentum`) — no special-casing a public route now that has to be walked back later once
real paid analysis logic (Section 3 items 2-3) sits behind it. New `ANALYSIS_SERVICE_URL` env
var (`backend/src/config/env.ts` + `.env.example`), defaults to `http://localhost:8000`. 3 new
backend tests (`analysis.controller.test.ts`: 401/200/503) using the established
partial-mock-for-Error-subclass pattern (`AnalysisServiceError` needs to survive `instanceof`
checks, so `jest.mock` uses `jest.requireActual(...)` spread + only `checkHealth` replaced —
same pattern `userSubscription.service`'s tests already use). 158 backend tests total,
`tsc`/lint clean.

New independent `analysis-service` CI job in `.github/workflows/ci.yml` (first Python job in
this repo, via `actions/setup-python@v5` + Poetry installed via `pipx` before the cache step)
— `poetry run pytest`, no `continue-on-error` since it has zero external dependencies (unlike
`e2e`'s CockroachDB Cloud dependency), so it's a hard gate from day one like `backend`.

**Verified live — the actual Section 2 test gate** ("a trivial health-check endpoint
round-trips through the Node gateway"): `poetry run uvicorn` on port 8000 (`curl
localhost:8000/health` → `{"status":"ok"}`, `/docs` → 200 Swagger UI) + `npm run dev` on port
4000, then via curl: no-cookie → `401`; signed-up throwaway user, authenticated → `200
{"status":"ok"}` (the actual round-trip: client → Node auth-check → Python FastAPI → back
through Node → client); killed the Python process, re-curled authenticated → `503
{"error":"Analysis service unavailable."}` — not a crash, confirming `analysisService.ts`'s
timeout/error handling degrades gracefully. Throwaway user deleted from the real DB afterward.

**Known gap**: Docker itself is not installed on the machine this was built on, so the
`Dockerfile` has not been build/run-verified end-to-end (only the direct `poetry run uvicorn`
path was live-tested). Revisit — build and run the image, confirm `/health`/`/docs` work
identically from inside the container — once Docker is available, ideally before Phase 5
(Docker for the rest of the stack) assumes this Dockerfile as a working template.

**2026-08-14 — Python version pin corrected 3.12 → 3.14**: this machine never had Python 3.12
installed at all — only 3.14 (`C:\Python314`) — so `pyproject.toml`'s original `python =
"^3.12"` constraint had been silently satisfied by 3.14 the entire time Poetry's virtualenv
was in use; the `Dockerfile`'s `python:3.12-slim` base and CI's `actions/setup-python
python-version: '3.12'` both claimed a version that had never actually been exercised on this
project (compounded by the Docker gap directly above — the 3.12 container path was never
built, so the mismatch had no chance to surface). Repinned all three to `3.14`
(`pyproject.toml`, `Dockerfile`'s `python:3.14-slim`, and the CI step) and regenerated
`poetry.lock` accordingly. **Verified**: `poetry check` clean, `poetry install` resolved with
no changes needed, all 149 Python tests pass under the new lock. **Known gap still open,
now also covers this**: `python:3.14-slim` actually pulling and building successfully in
Docker remains unverified for the same reason as above — only the constraint/lock/local-venv
side of this change has been confirmed live.

`e2e/SCENARIOS.md`: explicitly not updated — this phase adds zero new browser-facing flow
(the health-check round-trip is server-to-server only), per CLAUDE.md's E2E-coverage-decision
rule.

### Long-Term Analysis (Section 3 item 2) ✅ Done

**Built 2026-07-26** — the first real business logic in `analysis-service`, and the first
full exercise of the Node→Python gateway pattern end to end. Ported the deterministic
point-scoring model from the source app's `lt-analysis.html` (NOT the newer, qualitative
`lt-mt-stock-analyzer` Claude skill — that requires an LLM+web-search workflow, which isn't
deployable as a stateless FastAPI endpoint; the two now serve different surfaces with no
conflict).

**Python** (`analysis-service/app/models/long_term.py`, `app/scoring/long_term.py`): pure
functions — `bucket_grades` (regex classification + dedupe-to-latest-per-firm, ported
verbatim from the source's client-side logic, now server-side), `compute_financial_growth`,
`compute_earnings_surprise_pct` (most recent quarter only, matching source), `compute_valuation`,
`derive_conviction` (the exact ported mt/lt point rules), `build_bull_bear_signals`. New
`POST /long-term-analysis` endpoint in `app/main.py`. **Two source-app bugs/quirks
deliberately preserved or fixed, both flagged during `/plan`**: (1) the source's `epsGrowth`
variable name inside `deriveConviction()` was actually net-income growth, not EPS growth —
kept as a distinct `netIncomeGrowthPct` field, separate from the genuine `eps.yoyPct` used
by bull/bear signals, so the two don't get silently conflated; (2) the source's forward-P/E
scoring rule was dead code in production (it read `profile.pe`, which doesn't exist in FMP's
`/stable` tier, so `fwdPe` was always `0` and the rule never fired) — **now activated with a
real forward P/E** (confirmed sourceable via FMP's `/stable/financial-estimates` `epsAvg`
field), so conviction scores now genuinely reflect forward valuation for the first time.
33 new pytest cases (`test_long_term_scoring.py`, `test_long_term_endpoint.py`), covering
every threshold boundary in the point-scoring rules.

**V1 scope beyond the ported model**: Forward P/E, EV/EBITDA (subject + peers, from FMP's
`/stable/key-metrics`), and a peer-group-average "sector" approximation (labeled as such in
the UI — it's an average of ≤4 peers, not a true sector index). Finnhub company-news was
also pulled into V1 (a mid-session scope addition) — **the first feature in the whole
platform to actually consume a user's stored Finnhub key**; `SubscriptionsPage.tsx`'s
"not used by any feature yet" copy is now stale-and-fixed to reflect this.

**Node** (`backend/src/services/longTermAnalysisData.service.ts`, new): owns every external
call (FMP + optional Finnhub) and the user's decrypted keys — reuses `marketData.service.ts`'s
`fmpGet` wrapper, adds ~10 new FMP endpoints never called elsewhere in this repo (profile,
income-statement, earnings-calendar, price-target-consensus, grades, stock-peers,
financial-estimates, key-metrics). Runs in parallel (`Promise.allSettled`) rather than the
source app's sequential-for-loading-UI shape, since that UX reason doesn't apply
server-side — worth noting this means one analysis request fires ~12-20 FMP calls at once.
Grades are passed through **raw and undeduplicated**; Python does the bucketing — Node's job
is data-fetching/field-selection only, never scoring (same data-ownership split recommended
for the later Contrarian Analysis extraction, Section 3 item 5). `analysisService.ts` gained
`computeLongTermAnalysis()` with its own 20s timeout (vs. `checkHealth`'s 5s — this call does
real computation over a larger payload). New `GET /analysis/long-term/:symbol` route,
`requireAuth`-gated like every other proxied route; a missing FMP key is a 503, a missing
Finnhub key silently degrades to an empty news list (optional, never blocks the report). 15
new backend tests. 170 backend tests total, `tsc`/lint clean.

**Frontend**: new `LongTermAnalysisPage.tsx` (`frontend/src/pages/`), following
`MomentumPage.tsx`'s ticker-form/mutation-hook shape exactly (`useLongTermAnalysis()` in a
new `api/longTermAnalysis.ts`, mirroring the Python response model field-for-field — no
shared-schema codegen in this repo, so Python/Node/frontend types are 3 hand-maintained
copies of the same shape, same caveat as every other proxied feature here). Reuses
`StockPreviewChart` as a click-triggered modal, same pattern as `ContrarianFinderPage.tsx`.
New nav link + route registration. 2 new frontend tests (first test file for this
"mutation/form-submit page" shape, adapted from `SubscriptionsPage.test.tsx`'s structure).
29 frontend tests total, `tsc`/lint clean.

**Manually verified live against a real FMP account, 2026-07-26/27 — 3 real bugs found and
fixed, 1 confirmed plan-tier limitation (not a bug):**
1. **Peers were always empty.** `/stable/stock-peers` returns the peer list as a flat array
   of peer objects directly — the code was reading a `peersList` wrapper field that doesn't
   exist in this API tier. Fixed.
2. **Earnings-surprise data was wrong.** `/stable/earnings-calendar?symbol=X` silently
   **ignores the symbol parameter** and returns that day's market-wide earnings calendar —
   not AAPL-specific data at all. Fixed to use `/stable/earnings?symbol=X`, the correct
   per-symbol actual-vs-estimate history. A second latent bug was caught alongside it: an
   upcoming, not-yet-reported quarter (`epsActual: null`) could sort ahead of the last
   genuinely reported one, corrupting the surprise-% calc — fixed by filtering on
   `epsActual != null` before sorting.
3. **Peer P/E was always null.** `/stable/quote` has no `pe` field at all — confirmed live,
   the same gap as `profile.pe` (which is *why* the forward-P/E scoring rule was dead code
   in the source app to begin with). Fixed by deriving peer P/E from `1/earningsYield`, a
   field already being fetched via `key-metrics` for EV/EBITDA — no extra API call needed.
4. **Forward P/E stays `null` — confirmed a real account-plan limitation, not a bug.**
   `/stable/financial-estimates` returns `[]` for both AAPL and MSFT on the test account
   used. The code degrades gracefully exactly as designed (`forwardPe: null`, the scoring
   rule simply doesn't fire) — this would need a higher FMP plan tier to actually populate,
   not a code fix.

All fixes verified against real AAPL data: peer P/E/EV-EBITDA/market cap and 4 genuinely
reported quarterly EPS surprises all populate with sensible real values. 170 backend / 33
Python / 29 frontend tests still green after the fixes.

`e2e/SCENARIOS.md`: not updated this pass — no new pilot-scenario-relevant flow (the pilot
covers Signup→Login→Portfolio, not this feature); revisit once E2E coverage expands beyond
the single golden path.

### Contrarian Comeback Analysis (Section 3 item 3) ✅ Done

**Built 2026-07-28** — the second full business-logic feature in `analysis-service`, greenfield
in Python (no legacy JS output to diff against), across 3 formally-planned phases: Phase 1
(gate/auto-checks + 5-factor score + verdict), Phase 2 (Fundamental Health + Catalyst
Pipeline), Phase 3 (Staged Entry + Recovery Targets + Thesis Invalidation). Ported from the
source app's `contrarian-analysis.html`, re-read verbatim rather than assumed from the
earlier Phase-3 scoping note. Stateless two-endpoint pattern: `POST
/contrarian-comeback/gate` (auto-check preview) and `POST /contrarian-comeback` (full submit
with the user's checklist answers) — both independently re-fetch/recompute, same philosophy
as Contrarian Finder's per-batch `assembleUniverse()`. New `ContrarianComebackPage.tsx`.
Real bug found and fixed during live validation: `/v4/insider-trading` is a retired FMP
legacy endpoint (403 on accounts created after 2025-08-31) — switched to
`/stable/insider-trading/search`. Merged via PR #3.

### Top-Level UI Restructure, Cross-Tab Launchers, and Data Fixes ✅ Done

**Built 2026-07-29.** Three bundled pieces of follow-on work:
- **Persistent-tabs restructure**: the 5 tools (Dashboard + 4 analysis pages) collapsed from
  separate React-Router routes into one always-mounted `TabShell.tsx` (single `path="/*"`
  route) — switching tabs no longer unmounts/resets in-progress state. API Keys became a
  modal (`SubscriptionsPage.tsx` now takes `onClose`) instead of its own `/subscriptions`
  route.
- **Cross-tab analysis launchers**: a new `frontend/src/lib/tickerHandoff.ts` context lets
  Contrarian Finder's Candidates/Strength List rows and Momentum's Strength List/result
  header launch Long-Term Analysis or Contrarian Comeback directly for a symbol (Contrarian
  Comeback auto-runs Check Eligibility only — the checklist step still needs manual input).
  LT/CC buttons live in their own table column, not inline next to the symbol.
- **Contrarian Comeback data/UX fixes**: trailing P/E was always `null` (derived from
  price/EPS instead of FMP's `/stable` fields, which don't carry `pe` — same gap Long-Term
  Analysis hit); added Volume Ratio %/Volume Climax detection to Technical Indicators;
  Free Cash Flow now uses compact (M/B/T) currency formatting; added context-aware tooltips
  (Volume Climax true/false, insider SEC Form 4 transaction codes); merged the header/ticker-
  form/Contra Score into one card with per-factor score hints and a new Value Dislocation
  card.

Merged via PR #4. Full detail in this session's own history — see commit `229a169`.

### Momentum Analysis extraction (Section 3 item 4) ✅ Done

**Built 2026-07-29** — the first **extraction** (not greenfield build) of the Python
microservices work: `momentum.service.ts`'s pure math (SMA/EMA/RSI/MACD/Bollinger Bands, the
5-factor 0-10 score, entry/stop/target math) ported to `analysis-service/app/scoring/
momentum.py` as a **faithful line-for-line transliteration**, not a reformulation — TS
numbers and Python floats are both IEEE 754 doubles, so matching operation order exactly is
what makes value-for-value parity possible. `calcKellySizing()` was deliberately **not**
ported — it stays client-side only (`frontend/src/lib/kelly.ts`), unchanged, since capital is
a live-editable UI input.

**Shadow-test discipline** (this service has a documented history of a subtle bug — the
Kelly-sizing score-gate — regressing silently, so parity mattered more here than for the
greenfield features): rather than a live dual-engine comparison (no real production traffic
to shadow against at this project's scale), parity was proven **statically** — the relevant
Jest cases from `backend/tests/momentum.service.test.ts` (everything except the
`calcKellySizing` describe block) were ported 1:1 into `analysis-service/tests/
test_momentum_scoring.py`, same input fixtures, same already-trusted expected outputs.
17 new Python tests (139 total).

**Zero frontend changes, zero route/wire-contract changes** — `GET /momentum/:symbol` and
`frontend/src/api/momentum.ts`'s response shape are byte-identical before and after. Only
`momentum.controller.ts`'s `analyze()` handler changed internally: it now calls a new
`analysisService.computeMomentumAnalysis()` (POSTs to `/momentum-analysis`) instead of the
local `momentum.assembleMomentumAnalysis()` directly — same Node-fetches/Python-computes
split as Long-Term Analysis/Contrarian Comeback. **`momentum.service.ts` and its 22-test
Jest file stay in the repo, unmodified and undeleted** — the explicit rollback path (a
regression only needs the one controller line swapped back); deleting the now-dead TS file
is an explicit future cleanup, not done here. 1 new backend test (a 503-on-`AnalysisServiceError`
case, matching the other proxied controllers) — 201 backend tests total. `tsc`/lint clean on
both sides. Verified live against a real FMP account: `GET /momentum/AAPL` through the new
Python path returns a fully self-consistent result (score components summing correctly to
the documented signal threshold).

---

### Contrarian Finder extraction (Section 3 item 5) ✅ Done

**Built 2026-07-29** — the second extraction, and the last backend service still doing
scan-scoring math in TypeScript. **Data-ownership decision** (via a pros/cons comparison):
Node stays the sole DB owner — `assembleUniverse()`/`fetchSectorMap()`'s two read-only
`SELECT`s against static `m_index_constituent`/`m_tickers` reference data (538 rows, rarely
re-seeded) were judged too small to justify giving Python its own CockroachDB connection,
credential surface, and pool management for the first time; every other Python feature
already follows "Node fetches, Python computes," and there was no real technical case to
break that here.

**The real complexity**: unlike Momentum, `scanStock()` *interleaved* the FMP fetch and the
scoring math in one function — the fetch/compute split didn't already exist in the code. This
extraction introduced it: `contrarianFinder.service.ts` gained `fetchStockData()` (the
FMP-fetch half only, normalizing into `RawStockData` with bars kept unfiltered/null-preserved
so index-based lookups still line up) and `assembleScanBatch()` (fetches sector map + all
stocks' raw data in parallel, POSTs the whole batch to Python in **one call**, overlays the
sector-map fallback afterward). `analysis-service/app/scoring/contrarian_finder.py`
(`compute_scan_result`/`assemble_scan_batch`) is a faithful port of `scanStock()`'s post-fetch
logic, **reusing `mw_sma`/`mw_rsi`/`mw_bb` from the already-ported `momentum.py`** — no
re-porting needed, the direct payoff of having done Momentum first. New
`POST /contrarian-finder/scan-batch` endpoint.

**Today's `scanStock()`/`scanBatch()`/`filterCandidates()` stay in the file, unmodified and
undeleted** — same rollback-path precedent as `momentum.service.ts`
(`filterCandidates()` was already dead-server-side before this, from the 2026-07-27
gap-fix work — pre-existing, not something this extraction changed).

**Shadow-test discipline**: the 6 relevant `scanStock` Jest cases ported 1:1 into
`test_contrarian_finder_scoring.py` (filterFail thresholds, noData, changePct/changeSinceDate
math including the mktClosed branch, the strength-screen qualification case), plus a new
null-quote case (the real shape a failed FMP fetch takes, since `fetchStockData` never
rejects) — 10 new Python tests (149 total). 8 new backend tests (209 total) — 1 controller
503-on-`AnalysisServiceError` case, 6 new `fetchStockData`/`assembleScanBatch` unit tests
(after discovering and fixing a design mistake: an initial `Promise.allSettled`/error-branch
in `assembleScanBatch` was dead code, since `fetchStockData` can't actually reject — simplified
to a plain `Promise.all`, with the real defensive case being "Python returns fewer rows than
requested," not "a raw fetch failed"). `tsc`/lint clean. **Zero frontend/route changes** —
verified live against a real FMP account: a real 15-symbol batch scan through the new path
returned correct sector overlays, pricing, and strength scoring.

This was the last Section 3 backlog item before Phase 4.

### Functional Authorization (RBAC) + Admin Console (Section 3 item 6) ✅ Done

**Built across 8 phases, 2026-07-31–08-02.** Full RBAC schema: migrations `015` (`m_roles`,
`m_role_permissions`, `users_roles`, `user_evt_usage`/`user_evt_usage_summary_monthly` per the
design settled in the original scoping note), `016` (`m_function_master` — catalogs only the
app "functions" that are genuine *exceptions* to "any signed-in user can use it," not a row
per feature), `017` (user status + a `create` permission), `018` (`api_keys:manage_own`).
New `requirePermission(key)` middleware (DB-backed, checks the caller's actual
`m_role_permissions` join — not a hardcoded role-name check anywhere). Closed the `/auth/me`
gap flagged in the original scoping: `GET /auth/me` now returns `{ id, email, roles,
permissions }`, replacing the old probe-`/portfolios`-and-catch-401 session-detection hack.

**Dedicated `/admin` console** (`AdminPage.tsx`) replacing the earlier dropdown-of-modals —
5 tabs (My API(s), Manage Users, Manage Functions, Manage Permission, Manage Role), edit-then-
save UX, role deletion. **Permission-based UI gating throughout, not role-name checks** — a
new `hasAdminConsoleAccess()` helper (`api/auth.ts`) checks for *any* of 4 admin-console
permissions rather than `roles.includes('admin')`, specifically so a differently-named
superset role (see Admin-Master below) gets the same access without being called "admin"
literally. Contrarian Finder's "Run Scan" button and the API Keys link/tab are both gated the
same way. Manage Users gained email/status/role filters and a sticky, one-line-per-user
desktop/tablet layout.

**Admin-Master Fallback API Key** — the user's own design, implemented as a single-function
change once traced: every key-dependent feature already funneled through
`userSubscription.service.ts`'s `getDecryptedKey()`, so the fallback (an account with no FMP
key of its own transparently uses a designated `admin-master`-role account's key) lives
entirely there. Models a 3-role bring-your-own-key-or-not split (`user`/`admin` fall back,
`user-contra-wokey` falls back, `user-contra-withKey` deliberately doesn't — bring-your-own is
its whole purpose). Documented in full in the repo-root `User Manual.md`.

**Real bugs found live and fixed**: `admin-master` initially saw a plain "API Keys" button
instead of the "Admin" link (the hardcoded role-name check couldn't recognize a
differently-named superset role — this is exactly what `hasAdminConsoleAccess()` above was
built to fix); logout still 401'd on `/portfolios` after an earlier fix only special-cased the
`['session']` query key — fixed with a general two-stage `setQueryData`-then-deferred-`clear()`
ordering that protects *any* active query observer, not just session's own; `listRoles()`'s
`userCount` was silently a string (CockroachDB's `COUNT()`/`INT8` columns round-trip as JS
strings via `node-pg`, not numbers) — caught only via a live curl check, not by unit tests
(which had been mocking numeric literals directly, masking the real driver behavior).

### Contrarian Finder Stock Universe + m_tickers sync (Section 3 item 7 — revised scope) ✅ Done

**Built 2026-08-02–03, tackled from a different angle than originally scoped.** The original
open question (item 7 below) was "keep hand-curating the static DJ30/NDX100/SP500/ETF
constituent lists, or source live index membership from FMP" — **that question is still
open**; the constituent lists themselves are untouched. What got built instead: making the
*metadata about* each universe symbol (name/sector/market cap) actually usable, since
`m_tickers` — the only table that could hold it — turned out to be 0% populated for name and
massively out of sync with the real 348-symbol universe (208 of 348 symbols had no
`m_tickers` row at all; confirmed live, not assumed).

- **`GET /contrarian-finder/universe`** — a new Stock Universe reference table (Symbol / Name
  / Sector / Market Cap / a ✓ column per index, sorted by index-membership count) on the
  Contrarian Finder page, visible to everyone (not gated behind `contrarian_finder:scan` —
  it's read-only reference data, not an action).
- **`m_tickers` is now the single source of truth for name/sector/market_cap** (migration
  `019` adds `market_cap`), kept populated from two live paths rather than a one-time static
  seed: **Portfolio Update** (`importHoldings()` inserts a bare row for any symbol a real CSV
  import introduces that `m_tickers` doesn't know yet) and a shared
  **`refreshTickerDataBatch()`** (FMP `/profile`, one consistent source for all three fields)
  reused by two different triggers — **"Run Scan (+ Mkt Cap)"** (a de-emphasized, confirm-
  gated link next to the primary "Run scan" button; piggybacks a full refresh onto the scan's
  own batch/pacing, no new rate-limit logic needed) and the Admin Console's new **"Master
  Data"** tab's **Delta Update** (missing-only refresh, admin-only, gated by the same
  `contrarian_finder:scan` permission as Run Scan so the two stay in sync).
- **Real bugs found live**: BTC/ETH holdings' prices silently never updated on Refresh Prices
  — FMP's stock-quote endpoint doesn't resolve bare crypto tickers (`BTC`), it needs the pair
  format (`BTCUSD`); fixed by mapping crypto symbols to FMP's pair format for the quote fetch
  only, reversed on the way back so the rest of the app keeps using the bare symbol. A
  `HoldingsTable.tsx` regression (built the same week, see below) was caught by the E2E golden
  path failing for real.

**HoldingsTable Major/Minor allocation tabs** (a smaller, standalone UI change, same week):
holdings split into "Major" (>2.5% of portfolio) and "Minor" (≤2.5%) tabs, default-sorted by
$ value descending. **Regression found via E2E, not manual testing**: a fresh CSV import never
sets `allocation_pct` (only `refreshPrices()` ever computes it), so every newly-imported
holding had `null` allocation — the initial `?? 0` default bucketed all of them into Minor,
meaning a brand-new portfolio showed "0 stocks" in the default (Major) tab until the user
thought to click Refresh Prices first. Fixed: null allocation now defaults to Major (unknown
weight should default to *shown*, not *hidden*).

**CI/E2E, same investigation**: a flaky `useLogout` test (raced a real 10ms wall-clock wait
against a deferred `setTimeout(0)`) failed for real in GitHub Actions after being reliably
green locally — fixed with fake timers advanced by exactly 0ms (not `vi.runAllTimers()`,
tried first, which also fires React Query's own ~5min `gcTime` eviction timer and garbage-
collects the unobserved session query). The `tab-navigation.feature` E2E scenario's "API Keys
modal" check was testing an assumption Phase 8's permission-gating had already invalidated (a
brand-new signup has no `api_keys:manage_own` by default, by design) — fixed by granting the
permission via a dedicated, self-contained E2E-only role rather than relying on any
dev-database-only manually-created role. **All 4 GitHub Actions jobs (backend/frontend/
analysis-service/e2e) confirmed green** on the resulting commit, checked directly via the
Checks API — e2e had been reliably green on every commit since it was scaffolded (2026-07-23)
and had never actually failed before this round, confirming these were real regressions worth
fixing properly, not pre-existing flakiness.

### Contrarian Finder — shared last-scan persistence ✅ Done

**Built 2026-08-04.** The user, using the app normally, noticed the Contrarian Finder page
showed no results on a fresh visit and asked whether there was some "was this run today"
staleness check hiding old data. There wasn't — the actual cause was more basic: a completed
scan's results had never been persisted anywhere shared. `useContrarianBatchScan()`'s data
only ever lived in that browser tab's React Query cache and `sessionStorage`. Since only
Admin/Admin-Master/`user-contra-*` roles can run a scan (Functional Authorization, above) and
every other role can only *view* the outcome, this was a real, user-facing gap: a regular
user — or the same admin on a different device or a fresh session — saw nothing at all,
regardless of how recently a scan had actually completed.

**New `tx_shared_contrarian_run` table** (migration `020`) — one row per completed scan,
written once at the very end of a successful run, never per-batch and never for an
abandoned/failed one. Deliberately `tx_`-prefixed despite not being portfolio-scoped, a
documented departure from `SCHEMA.md`'s naming convention (the user's own call): running a
scan is itself a **transaction performed by a role** — not just an admin-exclusive system
job, but something both `admin` and the `user-contra-*` roles can trigger — so the `tx_`
prefix still fits the same "transactional record of an action a user took" sense the other
`tx_` tables carry, even though this particular transaction's *result* is shared/global
rather than scoped to that one user's own portfolio. This also sets the precedent for the
still-open "what prefix for non-user-scoped shared/cache data" question the on-hold shared
quote cache (Section 3 item 8 below) will eventually need answered. `started_by` (FK → `users`, `ON DELETE SET NULL`) is
stored but deliberately **not yet exposed** via the API — a "store now, decide how to surface
later" call, confirmed explicitly with the user during planning. No `status`/`error_message`
columns, since every row is by construction a completed run; "the last scan" is just
`ORDER BY completed_at DESC LIMIT 1`, with no cleanup/TTL needed (scans run infrequently).

- **`POST /contrarian-finder/last-scan`** — `requirePermission('contrarian_finder:scan')`
  (only someone who could run a scan should be able to claim to have completed one). Called
  fire-and-forget by the frontend the moment a scan's batch loop reaches `phase: 'done'`
  successfully — mirrors the existing `usageTracking.logUsage(...).catch(...)` non-blocking
  pattern already used server-side for the same event.
- **`GET /contrarian-finder/last-scan`** — no extra permission, same "viewing isn't the
  gated action" reasoning as `GET /contrarian-finder/universe`. Returns
  `{ lastScan: LastScanRecord | null }`, never a 404, so "nothing saved yet" is a normal
  frontend state, not an error branch.
- **New `useLastScanFallback()` hook** — originally `enabled` only when a `useRef` frozen at
  first render found neither the shared cache nor `sessionStorage` already held a scan; revised
  2026-08-05 (see the follow-up bug below) to always check on every mount, applying the result
  only when it's actually newer than what's currently shown.
- `ContrarianFinderPage`'s existing "Last scan used: ..." line now also shows the run's
  `completedAt` (sourced from whichever path populated `scan.data` — a locally-run scan
  stamps its own client-side timestamp the moment it finishes; a fallback-sourced scan uses
  the server's `completed_at` — no separate UI branch needed for the two cases).

**Real bug found+fixed via live verification, not by inspection**: a two-throwaway-account
test (one granted `admin`, one left as plain `user`, separate cookie jars against the real
dev DB) revealed `universe_size`/`scanned` (`INT8` columns) round-tripping through `node-pg`
as strings, not numbers — the same driver quirk already known from `roles.service.ts`
(`userCount`) and `marketData.service.ts` (`marketCap`), just not yet hit on this new query.
Fixed with the same `Number(...)` coercion in `getLastScan()`. Confirmed live end-to-end after
the fix: a plain `user` session saw `{ lastScan: null }` before any scan existed, got a real
`403` attempting the `POST` directly, and then — from a completely separate session/cookie
jar — saw the `admin` account's saved scan appear via `GET`, with `universeSize`/`scanned`
now genuine numbers. Throwaway accounts and the test's own scan row were deleted afterward,
confirmed via a direct row check.

10 new backend tests (service: `saveLastScan`/`getLastScan` INSERT/SELECT + JSONB round-trip;
controller: 403 without `contrarian_finder:scan`, 400 on a malformed body, 200 saving under
the caller's own `user_id`, `GET` 200 for any authenticated session with and without a saved
row — 385 total). 4 new frontend tests (fires the save call with the right body shape once
`phase` reaches `'done'`, does *not* fire it on a scan error, shows results sourced from the
server fallback for a session with empty local cache/`sessionStorage` including the
`completedAt` line, and one covering the original mount-gating logic below, later revised — 229
total across the frontend suite). Adding the new background `apiFetch` calls (the fallback
`GET` on mount, the fire-and-forget save `POST`) required updating several pre-existing
`ContrarianFinderPage` tests whose call-count assertions had implicitly assumed `apiFetch` was
only ever hit for the scan-batch endpoint — switched to a `scanBatchCalls()` filter helper
rather than raw `toHaveBeenCalledTimes()` against the whole mock, so those assertions stay
meaningful now that the same mock fields three different endpoints. `tsc`/lint clean both
sides.

**Follow-up bug found+fixed 2026-08-05, reported by the user in real use, not found by
inspection**: a plain-`user` account reported seeing an old (Aug 4) Contrarian Finder result
while the admin had already run two newer scans since, including one moments earlier the same
day (Aug 5). Root cause: `useLastScanFallback()`'s original mount-gating logic (previous
bullet) meant the *first* time any viewer's browser had zero local scan data, the fallback
fetch ran once, cached whatever the shared result was at that exact moment into both the
QueryClient cache and `sessionStorage`, and then — because local data now existed — never
fired again for that browser session, not even across a page reload (`sessionStorage` survives
a refresh; only a closed tab clears it). The viewer was permanently frozen on a stale snapshot.
Confirmed live before assuming where the bug was: the backend itself was correct the whole
time — a fresh throwaway account with zero local cache always received the true newest record
from `GET /contrarian-finder/last-scan`. Fixed by removing the mount-gate entirely:
`useLastScanFallback()` now checks on every mount unconditionally (a cheap, ungated,
single-row GET — negligible cost), and a new `isNewerCompletedAt()` comparison (ISO 8601
timestamps compare correctly as plain strings) decides whether to actually apply the result —
only when it's genuinely newer than whatever's currently shown, and never while `isPending`
(an active run in this same session), so a viewer's stale view now self-heals on its own next
visit/refetch instead of requiring a manual `sessionStorage` clear, while a session's own
freshly-completed run still can never be clobbered by an older result racing in behind it. The
"skipped entirely when `sessionStorage` already has a persisted scan" test (previous paragraph)
was replaced with two tests matching the corrected behavior: a stale pre-existing entry gets
upgraded once the fallback resolves something newer, and a fresh local run is never downgraded
by a deliberately-stale fallback response. 231 frontend tests total, `tsc`/lint clean.

### Contrarian Finder — tiered last-scan retention ✅ Done

**Built 2026-08-05.** After seeing `tx_shared_contrarian_run` (above) accumulate one row per
completed scan indefinitely, the user asked for tiered retention instead of unbounded growth:
a rolling **60-run history** for `admin`/`admin-master`, but a **single upserted row per user**
for every other `contrarian_finder:scan`-permitted role (`user-contra-withKey`/
`user-contra-wokey`) — confirmed explicitly this is per-user, not one shared row across all
non-admin runners, since the user's own framing was "my last scan," a different mental model
than the admin tier's shared history log.

- **Migration `021`** adds `run_tier VARCHAR(20) NOT NULL DEFAULT 'admin'` (backfilled `'admin'`
  for the 2 pre-existing rows — both genuinely admin-run) and a new
  `contrarian_finder:scan_history` permission. Granted to `admin` via the migration itself;
  `admin-master` needed a separate direct grant, since that role is a manually-created runtime
  row, never migration-seeded (same caveat as its other custom-role grants throughout this
  project).
- **`saveLastScan()` branches on tier**: `'admin'` does a plain `INSERT` into the history log,
  then prunes back to the most recent `ADMIN_HISTORY_LIMIT` (60) admin-tier rows via a second
  query. `'user'` does a transactional `DELETE ... WHERE started_by = $1 AND run_tier = 'user'`
  followed by a fresh `INSERT`, wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` — the same DELETE+INSERT
  pattern `roles.service.ts`'s `setUserRole()` already established, chosen over a partial-
  unique-index `ON CONFLICT` target (simpler to reason about and test, avoids relying on
  CockroachDB's partial-index `ON CONFLICT` inference for a single one-off case).
- **Tier resolution is permission-based**, not a hardcoded `role === 'admin'` check: the
  controller calls `rolesService.getUserPermissions(userId)` and checks for
  `contrarian_finder:scan_history` — consistent with the rest of this RBAC system
  (`requirePermission` is DB-backed throughout, never a role-name string check).
- **`GET /contrarian-finder/last-scan` is deliberately unaffected** — still just the single
  most recent row across both tiers, `ORDER BY completed_at DESC LIMIT 1`. Confirmed explicitly
  with the user this is a storage/retention change only, not a change to who sees what.

5 new backend tests (service: admin-tier insert+prune, user-tier upsert, user-tier
rollback-on-failure; controller: tier resolves to `'admin'` when the caller has
`contrarian_finder:scan_history`, `'user'` otherwise), `tsc`/lint clean. **Live-verified with
two throwaway accounts** against the real dev DB: an `admin` account running the save twice
left 2 accumulating `run_tier='admin'` rows (in order); a `user-contra-withKey` account running
twice left exactly 1 `run_tier='user'` row, whose content was the *second* run's (confirming
upsert-replace, not accumulate). Cleaned up afterward, confirmed via a direct row check.

### Permission dependency guard + Manage Permission UI indent ✅ Done

**Built 2026-08-05, same day.** A follow-on question about the new `contrarian_finder
:scan_history` permission — "should it and `contrarian_finder:scan` be mutually exclusive?" —
surfaced that the real relationship is the opposite: `scan_history` is a strict **child** of
`scan`, since the tier-check code only ever runs after `requirePermission('contrarian_finder
:scan')` has already let the request through. A role holding `scan_history` without `scan`
would never reach that check at all — granting it alone via the Admin Console's Manage
Permission screen would be a silent no-op, indistinguishable from a real, working grant.

- **`roles.service.ts`** gets a small `PERMISSION_REQUIRES: Record<string, string>` map
  (currently one entry — deliberately not a general dependency graph, extend by adding a line
  if a second such pair ever comes up) enforced in both directions: `grantPermission()` throws
  a new `MissingParentPermissionError` if the child's required parent isn't already granted to
  the role; `revokePermission()` throws a new `ParentPermissionInUseError` if any granted child
  still depends on the permission being revoked.
- **`roles.controller.ts`** maps these to `400` (grant) and `409` (revoke) respectively,
  matching this file's existing error-handling conventions (e.g. `RoleInUseError` → `409` for
  `DELETE /roles/:id`).
- **`RolePermissionsPage.tsx`** mirrors the same relationship for **display only** — a new
  `withParentChildOrder()` reorders the function checklist (normally alphabetical by name, per
  `GET /functions`'s `ORDER BY name`) so a child renders indented (`↳`, `marginLeft`) directly
  under its parent, rather than sorting to its own alphabetical position ("Contrarian Finder
  Scan History" would otherwise land well *before*, not after, "Run Contrarian Finder Scan").
  The backend stays the sole source of enforcement; a drift between the two maps would only
  ever cause a display glitch, never a bypass of the real guard.

6 new backend tests (4 service, 2 controller), 1 new frontend test, `tsc`/lint clean both
sides. **Live-verified via the real Admin Console API** against a throwaway role: granting the
child without the parent → `400`; granting the parent then the child → both `200`; revoking the
parent while the child is still granted → `409`; revoking the child then the parent → both
`200`. Cleaned up afterward.

### Contrarian Finder — SP500 tier expanded to top 400 ✅ Done

**Built 2026-08-05.** Resolved Section 2's "static constituent lists" open question (below) in
favor of a live-data-driven *regeneration* of the static file, not a runtime FMP dependency —
`cf_static_universe.ts`'s `sp500` array grows from 200 to 400 tickers, ranked by real market
cap, fully replacing the old list rather than appending to it (this also fixes a real,
previously-confirmed gap: MU, INTC, AMAT, ORCL, PLTR, PANW were all missing). `dj30`/`ndx100`/
`etf` stay completely untouched, by design — confirmed live before and after (30/88/20-per-ETF,
byte-for-byte unchanged).

**Data source, chosen after a live feasibility check, not assumed**: the official S&P 500
membership endpoint doesn't work on the current FMP plan (`/stable/sp500-constituent` 402s;
legacy `/v3/sp500_constituent` is fully retired) — confirmed by trying both live before falling
back to `/stable/company-screener`'s real market-cap ranking as a proxy (the user's own
explicit call, weighing an FMP plan upgrade against this zero-cost alternative). Getting a
clean top-400 out of that screener took several rounds of hand-verified filtering, not a single
pass: the raw results mixed in preferred stock/notes/trusts with bogus inflated market caps, an
OTC-traded utility-subsidiary instrument, and at least one outright **private company**
(`SPCX`/SpaceX, despite `isActivelyTrading: true`) — all caught by spot-checking suspicious
symbols directly against `/stable/quote` before trusting them. Duplicate-feed artifacts for the
same company (`APO`/`APOS`, `MMC`/`MRSH`) were resolved to the real primary ticker (`MMC`
specifically never appeared in the screener's own result set at all, despite resolving fine via
a direct quote lookup — a genuine FMP data-completeness gap, not a filtering bug); genuine
dual-class companies (`GOOG`/`GOOGL`, `FOX`/`FOXA`) keep both, matching the precedent the file's
own `etf.XLC` list already set. **Known, accepted residual risk** (same tradeoff class as the
original 200-symbol list): a handful of very recently IPO'd/spun-off large-cap companies (e.g.
`HONA`, `CBRS`, `Q`, `P`, `VG`, `MDLN`) clear the market-cap bar but may not yet be official
S&P 500 members — documented directly in the source file's own header comment.

**Real bug this surfaced**: `assembleUniverse()`'s `CF_MAX = 450` cap would have silently
truncated the ETF tier out of every actual scan once SP500 grew, since ETFs are added last in
tier order and `add()` stops the moment the running deduped total hits the cap — raised to
`600`. The live dedup simulation used to justify this during planning estimated ~540-600; the
real post-expansion total, re-simulated against the actual updated table, came in lower at
**458** (the real top-400 list overlaps more with the ETF tier than the pre-implementation
estimate assumed) — confirmed via a real `POST /contrarian-finder/scan-batch` call
(`universeSize: 458`, `totalBatches: 4` at the default batch size). Frontend's default
`maxBatches` raised 3→5 (625 symbols) so a plain "Run scan" click covers the full universe
without needing the Advanced panel — the idle-state explainer copy ("Scans up to N stocks...")
updated to match both the new cap and the corrected "S&P 500 Top 400" wording.

`m_index_constituent`'s seeding (`upsertConstituents()`) is upsert-only and never removes stale
rows, so `npm run seed:tickers` alone would have left the 35 tickers that didn't make the new
top-400 list still in the table — a one-time manual `DELETE ... WHERE index_id = 'SP500' AND
symbol NOT IN (...)` pruned those, confirmed via a before/after row count (200 → 435 → 400).

1 new backend test (`assembleUniverse`'s `CF_MAX` boundary — mocks a large-enough tier to prove
the raised cap is actually enforced at runtime, not just that the constant compiles — 396
total). Several pre-existing frontend tests updated for the new `maxBatches` default (both the
outgoing request body and the "Last scan used: ... max N batches ..." display text — one
test's own fixture data deliberately keeps `maxBatches: 3`, since it represents a *historical*
server-fallback record from a past run, not the live form default — 230 total). `tsc`/lint
clean both sides.

### Portfolio Upload — Flex ✅ Done

**Built 2026-08-07**, across 5 formally-planned phases in one continuous "auto mode" session
(scoped through extensive discussion 2026-08-06/07, `/plan`-approved, then executed
phase-by-phase without pausing — see `CLAUDE.md`'s "Portfolio Upload — Flex" section for the
full settled functional spec, including the forced Save-Template-or-Delete-Portfolio
resolution rule and the `flex_template_status` state machine). A new, parallel import path
alongside today's working "Legacy" import (`parser.service.ts`, untouched): any CSV/XLS file
with a header row, mapped by the user to the app's fixed portfolio fields via a UI, saved as a
reusable, admin-governed template.

**Backend**: migrations 022-024 add `m_portfolio_template_mapping_master`/`_dtls`, 2 new
`tx_portfolios` columns (`upload_template_id`, `flex_template_status`), and 3 new RBAC
permissions (`portfolio_upload:legacy` granted to `user` by default so nobody loses today's
import; `portfolio_upload:flex` and `portfolio_template:manage_status` admin-granted-only).
`parser.service.ts`'s per-row parsing logic was extracted into an exported
`buildHoldingsFromMappedRows()` — a pure refactor verified by the pre-existing `parseGenericCsv`
tests passing unchanged — so the new `flexParser.service.ts` (`resolveMapping()`/
`parseFlexCsv()`) reuses the exact same value-parsing/derivation code as Legacy, just fed a
user-defined mapping instead of `HEADER_ALIASES`. New `portfolioTemplate.service.ts` owns
template CRUD/governance, including a composable-transaction `createTemplate(input, client?)`
so Save Template can atomically create-and-bind a template to a portfolio in one transaction.
`portfolio.service.ts` gained `createPortfolioFlex()`/`saveFlexTemplate()`/
`changeFlexTemplate()`, reusing the existing, already-tested `importHoldings()` write path
unchanged. New `POST /portfolios/flex` (supports a `dryRun` preview branch for the mapping
wizard's "Inspect Data" step, mirroring Legacy's own `dryRun` precedent),
`POST`/`PUT /portfolios/:id/flex-template`, and the `/portfolio-templates` router. 472 backend
tests (up from 467), `tsc`/lint clean.

**Frontend**: `ColumnMappingWizard` (file → header/field mapping → Inspect Data → top-5
preview), `FlexTemplatePicker` (searchable Approved list + personal Pending-Approval dropdown),
`FlexResolutionBanner` (the forced-resolution UI — re-runs the wizard if the original mapping
isn't still in browser session state, since a `Flex-Err` portfolio's mapping was never
persisted anywhere), `FlexPortfolioPage` (the new Flex sub-tab, reusing `KpiCards`/
`AllocationChart`/`PerformanceChart`/`HoldingsTable` unchanged), and
`PortfolioTemplateApprovalPage` (new Admin Console "Portfolio Templates" tab). The "Stock
Portfolio" tab became a "Portfolio" tab with **Legacy**/**Flex** sub-tabs in `TabShell.tsx`,
each hidden entirely for a session lacking the matching permission; a session with neither
falls back to a read-only Legacy view (`DashboardPage`'s new `readOnly` prop) rather than a
blank tab — the same defensive-default precedent `ContrarianFinderPage` already used. 256
frontend tests (up from 231), `tsc`/lint clean.

**Real bug found live and fixed same day**: the Legacy sub-tab's `PortfolioSelector` wasn't
filtered by `flexTemplateStatus`, so a Flex-created portfolio also appeared under Legacy, where
its header-alias-guessing importer would have silently overwritten data no longer matching the
portfolio's bound Flex template. `PortfolioSelector` gained an optional `filter` prop, wired
from `TabShell` as `p => p.flexTemplateStatus === null` for the Legacy sub-tab only — confirmed
live (and via a new test) that a Flex portfolio no longer leaks into the Legacy selector while
still appearing correctly under Flex.

**Verified live end-to-end** against the real dev server + CockroachDB Cloud instance, all
throwaway accounts/rows cleaned up afterward: brand-new-mapping creation → real Dashboard from
real persisted data → `flex_template_status: 'Flex-Err'` → Save Template → atomically bound
(`Flex` + `upload_template_id`, confirmed via direct row query) and appearing in the creator's
own Pending list; reusing that still-Pending template by id on a second portfolio → resolves
immediately to `Flex`; changing an already-resolved portfolio's template → re-import + rebind;
a plain `user` session correctly 403s on `POST /portfolios/flex`; the Admin Console's Portfolio
Templates tab lists a Pending template, shows its mapping + sample preview on expand, and
Approve flips it to `Approved` — immediately visible in a completely unrelated plain user's own
Approved-template list, confirming the full template-governance loop end-to-end.

---

## Section 2 — Next Step

**All items previously queued here (Section 3 items 6, 7, and the static-constituent-lists
follow-up) are now done** — see Section 1 above for full detail (RBAC + Admin Console; Stock
Universe/`m_tickers` sync; SP500 expansion to top 400). What's left, in rough priority order:

- **Usage Tracking, the part of item 6 not yet built.** The RBAC schema includes
  `user_evt_usage`/`user_evt_usage_summary_monthly` and a `usageTracking.service.ts` exists
  (logs `contrarian_finder_scan` events today), but the broader "measure per-user usage across
  every analysis feature toward future subscription tiering" scope wasn't carried further than
  that one call site.
- **Two small known-leftover cleanups**, both flagged and deliberately left alone rather than
  touched speculatively: an orphaned `apiKeys:bringMyOwn` permission (a naming inconsistency
  from before `api_keys:manage_own` was settled on — documented in `User Manual.md`, harmless,
  not yet decided whether to rename/remove); `momentum.service.ts`'s dead-but-undeleted
  functions (`assembleMomentumAnalysis`/`calcKellySizing`'s server-side twin), kept as the
  Python extraction's rollback path.
- **Phase 4 (shared quote cache, item 8)** stays on hold — design already settled (CockroachDB
  TTL table), just deprioritized, per the user's 2026-07-29 call.

---

## Section 3 — Backlog (serial, in order)

1. **First E2E test suite — Playwright + Cucumber (`playwright-bdd`), single pilot golden-path
   scenario. ✅ Done.** New top-level `e2e/` directory (its own npm project, matching `backend/`/
   `frontend/`'s split — no workspaces exist to join). Gherkin `.feature` files for BDD
   readability, Playwright's engine underneath for speed/reliability — originally proposed as
   Selenium+Cucumber, switched to Playwright when presented with the tradeoff (auto-waiting vs.
   WebDriver flakiness, no separate driver-binary management in CI). Scope deliberately narrow:
   **Signup → Login → Create portfolio → Import CSV → View dashboard KPIs/holdings** — one
   scenario, proving the whole chain (CI, both dev servers, a dedicated CockroachDB Cloud test
   database, the browser driver, Gherkin step wiring) works before investing in full page
   coverage, mirroring this doc's own Section 2 philosophy ("a trivial health-check endpoint
   round-trips... before any real analysis logic goes in"). Test DB: a second database on the
   same CockroachDB Cloud cluster (not a new local Docker Postgres), migrated via the existing
   `backend/src/db/migrate.ts` (reused as-is, no new DB access pattern) and cleaned up
   per-scenario via a direct `DELETE FROM users WHERE email = $1` (cascades through every child
   table, already the repo's proven cleanup shape). Added 5 `data-testid` attributes (additive
   only, no behavior change) to `LoginPage.tsx`/`SignupPage.tsx`/`PortfolioSelector.tsx`/
   `UploadImportDialog.tsx`/`KpiCards.tsx`/`HoldingsTable.tsx` — the repo had none before. CI: a
   new `e2e` job in `.github/workflows/ci.yml`, gated behind the existing `backend` job, starting
   `continue-on-error: true` until proven stable over several runs. **Positioned here** —
   immediately after Section 2's Python scaffolding, before item 2 (Long-Term Analysis) — so its
   value as a regression net is available through the riskiest upcoming work (items 4-5's
   Momentum/Contrarian TS→Python extractions) and so Long-Term Analysis / Contrarian Comeback
   Analysis (items 2-3, both new pages) get E2E coverage as they're built rather than retrofitted
   later. Scaffolded 2026-07-21. **Confirmed done 2026-07-29**: the dedicated CockroachDB Cloud
   test database and the `E2E_DATABASE_URL` GitHub secret are both provisioned and working —
   verified via GitHub Actions history, the `e2e` job (which fails fast if `DATABASE_URL` is
   unset, per `migrate-test-db.ts`'s own guard) has passed on every run since at least
   2026-07-23. **Tab-shell mechanics now covered, 2026-07-29**: new
   `e2e/features/tab-navigation.feature` (2 scenarios — tab-switch state preservation, API
   Keys modal open/close), reusing `TabShell.tsx`'s existing `data-testid`s so zero new
   `data-testid`s were needed anywhere. All 3 scenarios (golden path + both new) verified
   live against the real test DB. **Deliberately still deferred**: the actual analysis tools
   (Momentum/Contrarian Finder/Long-Term Analysis/Contrarian Comeback returning real results)
   and the cross-tab launchers need either a live FMP test key in CI or Playwright
   route-mocking to exercise meaningfully — neither decided yet.
2. **Long-Term Analysis — built greenfield in Python. ✅ Done 2026-07-26** — see Section 1 for full detail. No existing backend service to migrate away from (the source app only has `lt-analysis.html` + the `lt-mt-stock-analyzer` skill), so this was new logic, not an extraction — proved the Node-gateway-to-Python pattern for real. Test gate: `pytest` coverage on the analysis logic itself was the correctness bar, since there was no legacy JS output to diff against.
3. **Contrarian Comeback Analysis — built greenfield in Python. ✅ Done 2026-07-28** — see Section 1 for full detail. Deferred from Phase 3: the full gate-check/fundamental-health/scoring/thesis workflow from `contrarian-analysis.html`, ~500+ lines of logic with zero backend equivalent today. Sized like item 1 (this doc's item numbering, not the E2E item above), not a quick port — same rationale for going straight to Python rather than a throwaway Node version. Test gate: same as item 2, `pytest` coverage is the correctness bar.
4. **Momentum Analysis — extracted from `momentum.service.ts`. ✅ Done 2026-07-29** — see Section 1 for full detail. `calcKellySizing` was not ported (stays client-side). Test gate: the relevant Jest fixtures ported 1:1 into pytest, value-for-value — the TS version stays in place, unmodified, as the rollback path.
5. **Contrarian Finder — extracted from `contrarianFinder.service.ts`. ✅ Done 2026-07-29** — see Section 1 for full detail. Node stayed the sole DB owner (pros/cons comparison favored consistency with every other Python feature over Python getting its own CockroachDB connection). Test gate: the relevant Jest fixtures ported 1:1 into pytest, value-for-value — the TS version stays in place, unmodified, as the rollback path.
6. **Functional Authorization (RBAC) + Admin Console. ✅ Done 2026-08-02** — see Section 1
   above for full detail (schema, `requirePermission`, the `/auth/me` fix, the Admin Console,
   Admin-Master Fallback API Key). **Usage Tracking is only partially done**: the
   `user_evt_usage`/`user_evt_usage_summary_monthly` tables and `usageTracking.service.ts`
   exist and log Contrarian Finder scans, but per-feature usage tracking toward subscription
   tiering wasn't extended to every analysis-triggering controller — that remains open, see
   Section 2.
7. **Contrarian Finder stock universe overhaul. ✅ Done 2026-08-03, from a revised angle** —
   see Section 1 above (Stock Universe reference table, `m_tickers` sync, "Run Scan (+ Mkt
   Cap)", Master Data Delta Update). At the time, this deliberately fixed the *metadata about*
   each universe symbol, not the universe membership itself — the constituent-list question
   itself was resolved separately, two days later: **the SP500 tier expanded from 200 to 400,
   ✅ Done 2026-08-05, see Section 1 above.** `DJ30`/`NDX100`/ETF membership stayed untouched
   (never part of that open question) and remain hand-curated.
8. **Phase 4 — Shared quote cache. ⏸ On hold (deferred by the user 2026-07-29, not started).**
   Behind `GET /quotes`, so concurrent users requesting the same symbol within e.g. 30-60
   seconds hit the cache, not FMP again. Also move the Contrarian Finder's scan-history
   tracking into the DB. **Design already discussed and settled, ready to resume from when
   picked back up:**
   - **Redis vs. Postgres/CockroachDB TTL table → TTL table wins.** CockroachDB Cloud is
     already provisioned/battle-tested in this build; a TTL table adds zero new
     infrastructure, secrets, or failure modes (Redis would mean a whole new service to
     provision, host, and handle "unreachable" for). CockroachDB's native row-level TTL
     (`WITH (ttl_expire_after = '60s')`) is a first-class feature, not a workaround. The one
     real tradeoff (DB read latency vs. in-memory Redis) doesn't matter here — the cache only
     needs to beat a live FMP call, which it does easily either way. Redis's raw throughput
     advantage isn't needed at this project's actual traffic scale.
   - **Structure: UPSERT-keyed by `symbol` (a cache, not an append-only log)** — `CREATE TABLE
     ... (symbol STRING PRIMARY KEY, price DECIMAL, ..., fetched_at TIMESTAMPTZ) WITH
     (ttl_expire_after = '60s')`. Every fresh FMP fetch `UPSERT`s the existing row rather than
     inserting a new one, so table size is bounded by the *count of distinct symbols ever
     looked up* (a few hundred to low thousands, given Contrarian Finder's own `CF_MAX = 450`
     universe cap), never by time or request volume — no unbounded growth to worry about.
   - **Retention rule: the TTL window itself is the whole rule** — no separate cleanup logic
     needed. The read path should still filter on `fetched_at` freshness explicitly
     (`WHERE fetched_at > now() - interval '60 seconds'`) rather than trusting "row exists =
     fresh," since CockroachDB's TTL deletion job runs on its own cron cadence, not instantly
     at the expiry second — it's storage housekeeping, not the correctness mechanism.
   - **Open decision, not yet resolved**: table naming. This doesn't fit the existing
     `m_`/`tx_`/`sys_`/unprefixed convention (`backend/src/db/SCHEMA.md`) — it's shared,
     ephemeral, cross-user cache data, a genuinely new category. A `cache_` prefix was
     floated but not committed to; settle this when `/plan` actually starts.
9. **Phase 5 — Production hardening.** Docker for the rest of the stack (Python services are already containerized from Section 2), structured logging + Sentry, staging/prod environment + database separation, per-IP rate limits on auth endpoints.
10. **Phase 6 — Migration & cutover tool.** One-time "import my existing portfolio" tool reading today's `localStorage['pf-data']`/`['pf-cash']` shape and POSTing it into the new account. Run both versions in parallel briefly, verify parity, then decommission the static-only deployment.

**How to apply:** before starting any item above, open with `/plan` mode to walk through that item's decisions with the user first.
