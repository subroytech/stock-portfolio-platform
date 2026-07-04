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
→ Node.js/Express backend + PostgreSQL (Aiven) + auth + REST API.
  Frontend is a placeholder — not started yet.

The full Architecture document (problem statement, shortcomings table, target architecture
diagram, and all 6 phases in detail) lives in the source repo at:
`../CreateStockPortfolioViewWOSkill/Architecture.md`

---

# Architecture Decisions Already Made

| Decision | Choice | Notes |
|---|---|---|
| Backend language | Node.js / Express | Already scaffolded |
| Database | Aiven PostgreSQL ($5/mo) | Migrations written, instance not yet provisioned |
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
  `holdings`, `cash_positions`, `uploads` — written but **not yet applied** (no Aiven instance)
- REST endpoints built: `GET /quotes` and `POST /contrarian-finder/scan`
- FMP/Finnhub keys moved to `backend/.env.example` + `src/config/env.js`
- Rate limiting middleware: `src/middleware/rateLimit.js` (wraps `/quotes` and `/contrarian-finder`)
- Services ported from source repo: `parser.service.js`, `momentum.service.js`,
  `contrarianFinder.service.js`, `livePrices.service.js`, `marketData.service.js`
  — each has a matching test file in `backend/tests/`
- Seed data ported: `cf_static_universe.js`, `empower_sector_map.js`, `header_aliases.js`,
  `ticker_sectors.js`

**Not yet built in Phase 1:**
- `POST /auth/signup` and `POST /auth/login`
- `GET / POST / PUT /portfolios` CRUD endpoints
- Aiven PostgreSQL instance not provisioned — DB-dependent endpoints are blocked

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
Features being actively developed there:
- Contrarian Finder (scan window selector, 7–15 days)
- Performance Widget (FMP-consistent price source, crypto exclusion)
- Live Prices (FMP quote proxy — eventually moves to this backend's `GET /quotes`)

When porting features here, check the source repo's `FEATURES.md` for the current
implementation details before writing backend equivalents.
