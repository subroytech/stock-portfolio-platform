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

## Section 1 — Accomplished Till 07-11 20:47

### Phase 0 — Foundations ✅ Done
- `backend/`/`frontend/` split; `frontend/index.html` is still a placeholder.
- `.github/workflows/ci.yml` — lint + test on push/PR, Node 20.

### Phase 1 — Backend API & Data Model ⚠ Partial

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
(`tsc --noEmit`) was added alongside the existing lint/test steps. Not yet verified live on
GitHub Actions (no push made since the fix).

**Not yet built in Phase 1:** `POST /auth/signup`/`login`, portfolio CRUD endpoints. Both are unblocked (DB is ready) — they're just not written yet. See Section 2.

### Phases 2–6 — Not started
Frontend framework decided (React, for Phase 3 — porting behavior/UX, not the old `innerHTML` markup), but no code written; formal planning deliberately deferred until Phase 2 is further along.

---

## Section 2 — Next Step

**Auth approach decision + `POST /auth/signup`/`login`.** Roll-your-own (bcrypt + JWT) vs. managed provider (Clerk/Auth0/Supabase Auth) — decide first, then build TS-native.

- **Test gate:** unit tests for hashing/token logic + `supertest` integration tests (pattern already used in `tests/app.test.ts`).

---

## Section 3 — Backlog (serial, in order)

1. **Portfolio CRUD endpoints** (`GET/POST/PUT /portfolios` against `tx_portfolios`/`tx_holdings`/`tx_cash_positions`/`tx_uploads`). Test gate: integration tests per endpoint, plus an explicit check that every write is scoped by `user_id`.
2. **User API-key model decision.** Each user brings their own FMP/Finnhub key (stored encrypted) vs. a shared pooled backend key with per-user quota — determines whether "Live Prices" stays a paid-tier-gated feature per user or becomes a shared platform cost.
3. **Phase 3 — React frontend.** Port behavior/UX (widget layout, KPI cards, signal/color conventions, chart configs), not the old `innerHTML`-string rendering code. Mobile-first per component (the 10-column holdings table and the fixed 2-column widget grids are the biggest desktop-only offenders to fix). Replace every direct `fetch(FMP/...)` call and all `localStorage` portfolio persistence with calls to the backend API. Test gate: component tests + a real browser walkthrough of the golden path before calling it done.
4. **Python service scaffolding.** New `analysis-service/` running FastAPI (Pydantic request/response validation, auto-generated OpenAPI docs), Dockerized from day one, `pytest` wired up. Test gate: a trivial health-check endpoint round-trips through the Node gateway before any real analysis logic goes in.
5. **Long-Term Analysis — built greenfield in Python.** No existing backend service to migrate away from (the source app only has `lt-analysis.html` + the `lt-mt-stock-analyzer` skill), so this is new logic, not an extraction — lowest-risk place to prove the Node-gateway-to-Python pattern for real. Test gate: `pytest` coverage on the analysis logic itself is the correctness bar, since there's no legacy JS output to diff against.
6. **Momentum Analysis — extracted from `momentum.service.ts`.** Port the RSI/SMA/Bollinger Band/Kelly-sizing math to Python (`pandas`/`numpy`/`ta`). Test gate: shadow-test the Python port against the existing Jest fixtures value-for-value before the gateway cuts over; keep the TS version in place as a rollback path until confidence is high. (This service has a documented history of a subtle bug — the Kelly-sizing score-gate — slipping through silently, so the shadow-test discipline matters more here than it might elsewhere.)
7. **Contrarian Analysis — extracted from `contrarianFinder.service.ts`**, once a data-ownership call is made: Node stays the sole DB owner and passes the pre-fetched universe + price data into Python as a request payload (recommended, keeps Python purely computational), vs. giving the Python service its own CockroachDB connection. Test gate: same shadow-test discipline as step 6.
8. **Phase 4 — Shared quote cache.** Redis or a TTL table, behind `GET /quotes`, so concurrent users requesting the same symbol within e.g. 30–60 seconds hit the cache, not FMP again. Also move the Contrarian Finder's scan-history tracking into the DB.
9. **Phase 5 — Production hardening.** Docker for the rest of the stack (Python services are already containerized from step 4), structured logging + Sentry, staging/prod environment + database separation, per-IP rate limits on auth endpoints.
10. **Phase 6 — Migration & cutover tool.** One-time "import my existing portfolio" tool reading today's `localStorage['pf-data']`/`['pf-cash']` shape and POSTing it into the new account. Run both versions in parallel briefly, verify parity, then decommission the static-only deployment.

**How to apply:** before starting any item above, open with `/plan` mode to walk through that item's decisions with the user first — this is especially true for Section 2 (auth provider) and item 2 (API-key model), which are expensive to reverse once real user data is flowing.
