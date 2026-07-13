## Rebuild Plan — From Single-User Client-Side App to a Scalable Multi-User Platform

**Last updated:** 2026-07-11

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

## Section 1 — Accomplished Till 07-12 23:21

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

### Phases 3–6 — Not started
Frontend framework decided (React, for Phase 3 — porting behavior/UX, not the old `innerHTML` markup), but no code written; formal planning deliberately deferred until Phase 2 is further along.

---

## Section 2 — Next Step

**Phase 3 — React frontend.** Port behavior/UX (widget layout, KPI cards, signal/color
conventions, chart configs), not the old `innerHTML`-string rendering code. Mobile-first per
component (the 10-column holdings table and the fixed 2-column widget grids are the biggest
desktop-only offenders to fix). Replace every direct `fetch(FMP/...)` call and all
`localStorage` portfolio persistence with calls to the backend API. **Must show an explicit
"replace existing holdings with this upload?" confirmation before ever calling
`POST /portfolios/:id/import`** — that endpoint unconditionally replaces when called; the
confirmation is a UI responsibility, not something the backend enforces (noted during the
portfolio-CRUD plan, 2026-07-12). The frontend will also need a UI for adding/managing a
user's own FMP key (`PUT/GET/DELETE /subscriptions/fmp`) — without it, every authenticated
user hits the new 503 with nowhere to act on it.

- **Test gate:** component tests + a real browser walkthrough of the golden path before
  calling it done.

---

## Section 3 — Backlog (serial, in order)

1. **Python service scaffolding.** New `analysis-service/` running FastAPI (Pydantic request/response validation, auto-generated OpenAPI docs), Dockerized from day one, `pytest` wired up. Test gate: a trivial health-check endpoint round-trips through the Node gateway before any real analysis logic goes in.
2. **Long-Term Analysis — built greenfield in Python.** No existing backend service to migrate away from (the source app only has `lt-analysis.html` + the `lt-mt-stock-analyzer` skill), so this is new logic, not an extraction — lowest-risk place to prove the Node-gateway-to-Python pattern for real. Test gate: `pytest` coverage on the analysis logic itself is the correctness bar, since there's no legacy JS output to diff against.
3. **Momentum Analysis — extracted from `momentum.service.ts`.** Port the RSI/SMA/Bollinger Band/Kelly-sizing math to Python (`pandas`/`numpy`/`ta`). Test gate: shadow-test the Python port against the existing Jest fixtures value-for-value before the gateway cuts over; keep the TS version in place as a rollback path until confidence is high. (This service has a documented history of a subtle bug — the Kelly-sizing score-gate — slipping through silently, so the shadow-test discipline matters more here than it might elsewhere.)
4. **Contrarian Analysis — extracted from `contrarianFinder.service.ts`**, once a data-ownership call is made: Node stays the sole DB owner and passes the pre-fetched universe + price data into Python as a request payload (recommended, keeps Python purely computational), vs. giving the Python service its own CockroachDB connection. Test gate: same shadow-test discipline as step 3.
5. **Phase 4 — Shared quote cache.** Redis or a TTL table, behind `GET /quotes`, so concurrent users requesting the same symbol within e.g. 30–60 seconds hit the cache, not FMP again. Also move the Contrarian Finder's scan-history tracking into the DB.
6. **Phase 5 — Production hardening.** Docker for the rest of the stack (Python services are already containerized from step 1), structured logging + Sentry, staging/prod environment + database separation, per-IP rate limits on auth endpoints.
7. **Phase 6 — Migration & cutover tool.** One-time "import my existing portfolio" tool reading today's `localStorage['pf-data']`/`['pf-cash']` shape and POSTing it into the new account. Run both versions in parallel briefly, verify parity, then decommission the static-only deployment.

**How to apply:** before starting any item above, open with `/plan` mode to walk through that item's decisions with the user first — this is especially true for Section 2 (frontend framework/UX decisions), which is expensive to reverse once real user data is flowing.
