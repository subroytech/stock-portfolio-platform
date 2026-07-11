## Rebuild Plan — From Single-User Client-Side App to a Scalable Multi-User Platform

**Why this section exists:** the user identified the single biggest shortcoming of the current app: it's a 100% client-side, single-user project (no backend, no database, no auth — `localStorage` is the only persistence layer) and therefore cannot scale beyond "one person, one browser." This section documents how to recreate the project from scratch as a standard, scalable, multi-user application. It's a forward-looking architecture reference for a *future* rebuild — nothing here has been built yet.

### Current Shortcomings → Remediation in New Build

| # | Shortcoming (today) | Why it matters | Remediation in the rebuild | Addressed in |
|---|---|---|---|---|
| 1 | No backend — pure static HTML/JS | Zero compute layer to enforce business logic, quotas, or security server-side | Introduce a Node.js/Express backend API that owns all business logic, validation, and third-party calls | Phase 1 |
| 2 | No database — `localStorage` only | Data is trapped on one browser/device; cleared cache = data loss; no backup, no history | CockroachDB Cloud with `users`/`portfolios`/`holdings`/`cash_positions`/`uploads` tables as the single source of truth | Phase 1 |
| 3 | No user accounts / auth | The app has no concept of "a user" — can't support more than one person without data collision | Add real authentication (JWT or managed provider); every row in the DB is scoped by `user_id` | Phase 2 |
| 4 | FMP/Finnhub API keys stored in browser `localStorage` | Visible in DevTools to anyone with access to the machine; every user must obtain and pay for their own key; no key rotation or centralized quota control | Move keys to backend environment variables only; frontend never sees them; backend becomes the single billable, rate-limited caller | Phase 1 |
| 5 | Every browser tab calls third-party APIs directly | No shared caching — 10 users looking at AAPL trigger 10 redundant paid API calls instead of 1 | Add a shared quote cache (Redis or a `quotes_cache` table with TTL) behind the new `GET /quotes` backend proxy | Phase 4 |
| 6 | No multi-device sync | Upload a portfolio on a laptop, it's invisible on a phone | Portfolio data lives in the DB, not `localStorage` — any device, same login, same data | Phase 2–3 |
| 7 | No server-side validation | CSV/Excel/TXT parsing happens entirely in-browser; a malformed or hostile file is only ever checked client-side | Re-run/validate parsing server-side on upload (`POST /portfolios/import`) before persisting, in addition to the existing client-side checks | Phase 1, step 5 |
| 8 | No observability | No logs, error tracking, or usage metrics beyond what's visible in one person's browser console | Structured backend logging + error tracking (e.g. Sentry) + DB-backed usage/scan history | Phase 5 |
| 9 | No CI/CD, no automated tests | Every change is manually verified (e.g. via ad-hoc Playwright scripts in this session) rather than a repeatable pipeline | GitHub Actions pipeline: lint + unit tests (parsers, financial calcs) + integration tests (API) on every PR | Phase 0 & 5 |
| 10 | No environment separation | There's no staging vs. production — `index.html` *is* the production app | Separate staging/production deploys and databases, promoted via the CI/CD pipeline | Phase 5 |
| 11 | UI not designed for multiple form factors — several screens span full desktop width with no responsive breakpoints | App is unusable/cramped on tablet or mobile; a growing multi-user base will include non-desktop users | Rebuild frontend layout with responsive breakpoints (CSS Grid/Flexbox media queries, or framework-native responsive utilities) for laptop/tablet/mobile | Phase 3 |

### Target Architecture

```
┌──────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  Frontend    │◄────►│  Backend API       │◄────►│  PostgreSQL (DB)  │
│  (SPA/CDN)   │ HTTPS│  (Node.js/Express) │      │  CockroachDB Cloud│
└──────────────┘      │  - Auth (JWT)      │      └──────────────────┘
                       │  - Portfolio CRUD  │
                       │  - Quote proxy     │      ┌──────────────────┐
                       │  - Rate limiting   │◄────►│  Redis / cache    │
                       └─────────┬──────────┘      │  (shared quotes)  │
                                 │
                                 ▼
                       ┌───────────────────┐
                       │ FMP / Finnhub APIs │  (keys live ONLY here,
                       └───────────────────┘   never sent to browser)
```

Key shifts from today:
- **Backend owns all third-party API calls.** FMP/Finnhub keys move to backend environment variables; the frontend never sees them. The backend becomes the single rate-limited, billable caller — and can share one cached quote across every logged-in user.
- **Database owns all portfolio data.** `users`, `portfolios`, `holdings`, `uploads`, `cash_positions` tables replace `localStorage['pf-data']`/`['pf-cash']`. Data survives across devices and browser sessions.
- **Auth scopes everything.** Every API call is tied to a `user_id`; no more shared-browser data collisions.
- **Frontend becomes a thin client.** It calls the backend's REST API instead of FMP/Finnhub directly and instead of reading/writing `localStorage` for anything beyond a short-lived offline cache.

### Suggested Rebuild Steps (phased)

**Phase 0 — Foundations**
1. Confirm hosting stack: CockroachDB Cloud + a Node.js host (Render/Railway/Fly.io — pick one, all support a free/cheap tier suitable for this scale)
2. Split into two repos (or a monorepo with `/frontend` and `/backend`) — decouples deploy cadence and keeps the API key boundary architecturally enforced, not just by convention
3. Set up a GitHub Actions pipeline early (lint + test on every PR) so the rebuild itself doesn't regress silently

**Phase 1 — Backend API & Data Model**
4. Design the schema: `users`, `portfolios` (one user can have many, e.g. "Fidelity", "Empower"), `holdings` (symbol, qty, cost basis, etc. — mirrors today's `S.raw` entry shape), `cash_positions` (mirrors the new `S.cashAmount`), `uploads` (audit trail of what was imported, when, from which brokerage)
5. Build REST endpoints: `POST /auth/signup|login`, `GET/POST/PUT /portfolios`, `GET /quotes?symbols=...` (the new proxy — replaces direct `fetchQuotesFMP` calls from `js/live-prices.js`), `POST /contrarian-finder/scan`
6. Move `FMP`/`FINNHUB` base URLs and keys out of `js/utils.js` entirely — they become backend-only env vars; the frontend only ever talks to its own backend
7. Add per-user + per-IP rate limiting middleware (e.g. `express-rate-limit`) so one user can't exhaust the shared FMP quota for everyone

**Phase 2 — Auth & Multi-Tenancy**
8. Add authentication — either roll your own (bcrypt + JWT in an httpOnly cookie) or delegate to a managed provider (Clerk/Auth0/Supabase Auth) to save build time
9. Scope every query by `user_id`; migrate the upload flow (`loadData()` in `js/portfolio.js`) to `POST` parsed holdings to the backend instead of writing to `localStorage['pf-data']`
10. Decide whether users bring their own FMP/Finnhub keys (stored encrypted server-side, per-user) or share a pooled backend key with per-user quota allocation — this determines whether "Live Prices" stays a paid-tier-gated feature per user or becomes a shared platform cost

**Phase 3 — Frontend Refactor**
11. Decide: keep the current vanilla-JS multi-page structure (lower migration effort) or move to a component framework (React/Vue/Svelte) now that the app is becoming genuinely stateful via a real API — recommend a framework once auth/login screens and per-user routing enter the picture, since vanilla DOM manipulation (the current `js/portfolio.js` style) gets unwieldy past this point
11a. Design responsive breakpoints for mobile/tablet/laptop as part of that same framework decision (addresses shortcoming #11) — full-width desktop-only sections (e.g. the dashboard KPI grid, Contrarian Finder/Comeback widget row) get stacking/collapsing layout behavior below tablet/mobile breakpoints
12. Replace every direct `fetch(FMP/...)` call (`js/live-prices.js`, `lt-analysis.html`, `contrarian-analysis.html`, `contrarian-finder.js`) with calls to the new backend proxy endpoints
13. Replace `localStorage` portfolio persistence with backend API calls; keep `localStorage` only as a short-lived offline/optimistic-UI cache, not the source of truth
14. Add login/signup/account pages; handle session expiry gracefully (the app currently never "logs out" — this is a new UX concept to design)

**Phase 4 — Shared Caching & Background Jobs**
15. Add a shared quote cache (Redis, or a simple `quotes_cache` Postgres table with a TTL column) so concurrent users requesting the same symbol within e.g. 30–60 seconds hit the cache, not FMP again
16. Move the Contrarian Finder's ~450-stock universe and scan history into the DB instead of the hardcoded list in `contrarian-finder.js`
17. Consider a background worker/cron (instead of purely on-demand, per-browser-tab polling) for live price refresh, so the "Top 15 / All Others" refresh model becomes a scheduled job feeding the cache rather than N independent browser-triggered fetches

**Phase 5 — Production Hardening**
18. Containerize the backend (Docker) for portable, repeatable deploys
19. Add structured logging + error tracking (e.g. Sentry) — today, errors are only ever visible in one person's browser console
20. Add automated tests: unit tests for the parsers (`parseGenericCsv`, `parseRobinhoodTxt`, the new cash-redirect logic) and the financial calculations (Kelly sizing, conviction scoring, momentum indicators), integration tests for the new API endpoints
21. Separate staging vs. production environments/databases
22. Add basic abuse protection (per-IP rate limits on auth endpoints, CAPTCHA on signup if it goes public)

**Phase 6 — Migration & Cutover**
23. Build a one-time "import my existing portfolio" tool that reads today's `localStorage['pf-data']`/`['pf-cash']` shape and POSTs it into the new account, so no manual re-entry is needed when moving off the current single-user version
24. Run both versions in parallel briefly, verify parity (KPI cards, Live Prices, Contrarian tools all match), then decommission the static-only deployment

**How to apply:** start the actual rebuild with `/plan` mode — walk through Phase 0–1 decisions (hosting platform, schema, auth provider) with the user *before* writing any backend code, since those choices are expensive to reverse once data is flowing.
