# 1. Environment Details

*Written for a beginner. If a term needs a plain-English explanation, it gets one in
parentheses the first time it shows up.*

This document explains **what software is installed, what each piece is for, and how to
start the app on your own machine.** Nothing here explains *how the code works* — that's
`02-Functional-Code-Workflow.md`. Nothing here explains *how it's tested* — that's
`03-Test-Details.md`.

---

## 1.1 The big picture: three separate programs, one app

This isn't one program — it's **three separate programs that talk to each other over the
network**, plus one shared database. That split is intentional (it's how most real
production apps are built), but it does mean "the app" only really works when all three
pieces are running at once.

```
┌─────────────────┐        ┌──────────────────┐        ┌───────────────────────┐
│   frontend/      │  HTTP  │   backend/        │  HTTP  │  analysis-service/     │
│   (React, runs    │ ─────> │   (Node/Express,  │ ─────> │  (Python/FastAPI,      │
│   in the browser) │ <───── │   the "brain")     │ <───── │  pure number-crunching)│
└─────────────────┘        └────────┬──────────┘        └───────────────────────┘
                                     │
                                     │ SQL
                                     ▼
                          ┌────────────────────────┐
                          │  CockroachDB Cloud       │
                          │  (the database — lives    │
                          │  on the internet, not     │
                          │  on your machine)          │
                          └────────────────────────┘
```

- **`frontend/`** — the part you actually see and click on in a browser tab. It never
  talks to the database directly and never holds any secret API keys.
- **`backend/`** — the "brain." Every button click in the frontend eventually turns into a
  request to the backend. The backend is the *only* piece that talks to the database, and
  the only piece that holds real secrets (passwords, encryption keys, third-party API
  keys).
- **`analysis-service/`** — a separate Python program used only for heavier math (stock
  scoring models). The backend calls it the same way the frontend calls the backend — over
  HTTP, not by importing Python code into Node. If this service is off, the backend
  degrades gracefully (returns a clear error) instead of crashing.
- **CockroachDB Cloud** — the database. Unlike the other three, it isn't something you run
  on your laptop — it's a cloud-hosted service you connect to over the internet, all the
  time, even in local development.

---

## 1.2 What each piece is built with, and why

### `frontend/` — the browser app

| Tool | What it is | Why it's here |
|---|---|---|
| **React 19** | A library for building UIs out of reusable components (buttons, tables, pages) | Industry-standard choice for interactive dashboards |
| **Vite** | The tool that runs the frontend locally and bundles it for production | Much faster reload-on-save than older tools |
| **TypeScript** | JavaScript with type-checking added (catches "you passed a number where a string was expected"-type bugs before you even run the code) | Catches whole categories of bugs at write-time instead of in the browser |
| **Tailwind CSS v4** | A way of styling elements using short utility classes (`class="p-4 rounded"`) instead of writing separate CSS files | Fast to style, consistent look |
| **React Router** | Lets the app show different "pages" (Dashboard, Admin, Login) without actually reloading the browser | Standard for single-page apps |
| **TanStack Query** | Manages "data that came from the server" — caching it, refetching it, knowing when it's stale | Removes a lot of manual loading/error-state bookkeeping |
| **Chart.js** | Draws the charts (allocation pie chart, performance line chart) | — |
| **Vitest** | Runs the frontend's automated tests | Pairs naturally with Vite |

### `backend/` — the server

| Tool | What it is | Why it's here |
|---|---|---|
| **Node.js 20** | The JavaScript runtime the server runs on | — |
| **Express 5** | A framework for defining HTTP endpoints (`GET /portfolios`, `POST /auth/login`, etc.) | The standard, minimal choice for a Node API |
| **TypeScript (strict mode)** | Same benefit as the frontend, plus "strict mode" means the compiler is maximally picky — fewer surprises at runtime | The whole backend was converted to strict TS early on, specifically to reduce bugs |
| **pg** | The library that actually sends SQL to CockroachDB | — |
| **bcrypt** | One-way-hashes passwords before they're stored, so even a database leak doesn't expose real passwords | Security baseline for any login system |
| **jsonwebtoken (JWT)** | Creates the signed login token stored in the browser's cookie | Used instead of a third-party login provider — see `02` for how it works |
| **helmet** | Adds a handful of security-related HTTP headers automatically | Cheap, standard hardening |
| **express-rate-limit** | Stops one user/IP from hammering the API (e.g. 30 requests/minute) | Protects the shared FMP/Finnhub API quota and the database |
| **Jest** | Runs the backend's automated tests | — |

### `analysis-service/` — the Python microservice

| Tool | What it is | Why it's here |
|---|---|---|
| **Python 3.14** | The language | Chosen for its strong data/math libraries, should this service grow |
| **FastAPI** | A framework for defining HTTP endpoints, similar in spirit to Express | Modern, fast, has automatic request validation |
| **Poetry** | Manages Python dependencies and virtual environments (Python's rough equivalent of `npm`/`package.json`) | Standard modern choice |
| **uvicorn** | The actual server process that runs the FastAPI app | Required to run FastAPI at all |
| **pytest** | Runs this service's automated tests | Standard for Python |
| **Docker** (`Dockerfile`) | A recipe for packaging this service into a portable container | Written for future deployment; **not yet verified to actually build**, because Docker isn't installed on the dev machine this was built on — see `03-Test-Details.md` |

### Database

| Tool | What it is | Why it's here |
|---|---|---|
| **CockroachDB Cloud** | A cloud-hosted SQL database (PostgreSQL-compatible wire protocol) | Chosen over running a local database so the same connection setup works in dev, CI, and (eventually) production |
| **Plain `.sql` migration files** | Every schema change (new table, new column) is a numbered file in `backend/src/db/migrations/`, e.g. `025_add_flex_template_header_offset.sql` | No ORM (a library that auto-generates SQL for you) — SQL is written by hand and run in order, which keeps exactly what changed fully visible and reviewable |

### End-to-end testing (separate from the 3 services above)

| Tool | What it is |
|---|---|
| **Playwright** | Drives a real, automated browser to click through the app like a user would |
| **Cucumber (`playwright-bdd`)** | Lets test scenarios be written in plain English (`Given/When/Then`) before being wired to Playwright code |

Lives in its own `e2e/` folder, with its own `package.json` and its own dedicated test
database (never the real one).

---

## 1.3 Folder layout

```
stock-portfolio-platform/
├── frontend/              React app (what you see in the browser)
│   └── src/
│       ├── pages/         One file per screen (DashboardPage.tsx, AdminPage.tsx, ...)
│       ├── components/    Reusable pieces used across pages (HoldingsTable, charts, ...)
│       ├── api/           Functions that call the backend (one file per feature area)
│       └── lib/           Small helper functions with no backend/UI dependency
│
├── backend/               Express API (the "brain")
│   └── src/
│       ├── routes/        "This URL exists" — maps a URL + HTTP verb to a controller
│       ├── controllers/   "What to do when this URL is hit" — reads the request, calls a service, sends a response
│       ├── services/      The actual business logic (talks to the DB, calls FMP/Finnhub, etc.)
│       ├── middleware/    Code that runs on *every* matching request (auth check, rate limit, permission check)
│       ├── db/
│       │   ├── migrations/  Numbered .sql files — the database's version history
│       │   └── SCHEMA.md    Human-readable map of every table and how they relate
│       └── config/env.ts  Reads and validates all the environment variables below
│
├── analysis-service/      Python/FastAPI microservice
│   └── app/
│       └── scoring/       Pure math modules (momentum.py, long_term.py, contrarian_finder.py, ...)
│
├── e2e/                   End-to-end browser tests (Playwright + Cucumber)
│   └── features/          Plain-English test scenarios (.feature files)
│
├── Manual-TestScript/      Hand-written QA checklists for features not yet covered by automated tests
├── Architecture.md         The authoritative, actively-maintained rebuild plan (read this for *why* decisions were made)
├── CLAUDE.md                Instructions + running build log for AI-assisted development on this repo
└── User Manual.md           End-user-facing instructions (not this doc's audience)
```

---

## 1.4 Environment variables (secrets and settings)

Nothing secret is ever committed to git. Instead, each service has a `.env.example` file
(committed, safe, no real values) that you copy to a real `.env` file (never committed —
listed in `.gitignore`) and fill in yourself.

### `backend/.env`

| Variable | What it's for |
|---|---|
| `PORT` | Which port the backend listens on locally (`4000`) |
| `DATABASE_URL` | The CockroachDB Cloud connection string |
| `FMP_API_KEY`, `FMP_BASE_URL`, `FMP3_BASE_URL`, `FMP4_BASE_URL` | Financial Modeling Prep — the stock-data provider used for quotes/fundamentals. Note: individual users can also supply their *own* FMP key in-app (see `02`) rather than using this global fallback |
| `FINNHUB_API_KEY`, `FINNHUB_BASE_URL` | Finnhub — used for company news |
| `ANALYSIS_SERVICE_URL` | Where the backend finds the Python service (`http://localhost:8000` locally) |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_PER_USER`, `RATE_LIMIT_MAX_PER_IP` | Rate-limiting knobs |
| `JWT_SECRET` | The secret key used to sign login tokens — if this leaks, anyone can forge a valid login |
| `JWT_EXPIRES_IN` | How long a login stays valid (`7d`) |
| `IMPERSONATION_EXPIRES_IN` | How long an admin-master's "Login-as" session stays valid (`1h`) — deliberately much shorter than a normal login, since it's a borrowed, elevated session (see `02` §2.3) |
| `PASSWORD_RESET_EXPIRES_IN` | How long a Forgot Password challenge/reset token stays valid (`10m`) — short-lived and single-purpose, same pattern as the impersonation token above |
| `FRONTEND_ORIGIN` | Which URL is allowed to make authenticated requests to the backend (CORS) |
| `API_KEY_ENCRYPTION_KEY` | The key used to encrypt users' own FMP/Finnhub keys before storing them in the database |
| `NODE_ENV` | `development` locally, `production` when deployed |

### `analysis-service/.env`

| Variable | What it's for |
|---|---|
| `PORT` | Which port uvicorn listens on (`8000`), matching `ANALYSIS_SERVICE_URL` above |

### `e2e/.env.e2e`

Points Playwright at a **dedicated test database** (a second database on the same
CockroachDB cluster) — deliberately separate from the real data, so running the test
suite can never touch or wipe real portfolios.

---

## 1.5 Running everything locally

Each of the three services is started independently, in its own terminal:

```bash
# Terminal 1 — backend (http://localhost:4000)
cd backend
npm install
npm run dev

# Terminal 2 — analysis-service (http://localhost:8000)
cd analysis-service
poetry install
poetry run uvicorn app.main:app --reload

# Terminal 3 — frontend (http://localhost:3000, opens in your browser)
cd frontend
npm install
npm run dev
```

There's also `scripts/dev-restart.ps1`, a PowerShell helper for restarting these during a
dev session — see `scripts/README.md`.

The frontend and analysis-service are optional depending on what you're working on (e.g.
you can run just the backend and hit it with a tool like Postman), but the **full app**
needs all three running plus a working `DATABASE_URL`.

---

## 1.6 Continuous Integration (CI)

Every push and pull request against `master` automatically runs 4 independent jobs on
GitHub's servers (`.github/workflows/ci.yml`), each mirroring one piece above:

| Job | What it checks |
|---|---|
| `backend` | Type-checks, lints, and runs all Jest tests |
| `frontend` | Type-checks, lints, and runs all Vitest tests |
| `analysis-service` | Installs via Poetry and runs all pytest tests |
| `e2e` | Runs the Playwright/Cucumber browser tests against the dedicated test database (currently marked non-blocking — it can fail without blocking a merge, until it's proven stable over more runs) |

If the `backend`, `frontend`, or `analysis-service` job fails, that's a hard stop —
something is actually broken. CI uses safe, throwaway dummy values for `JWT_SECRET`/
`API_KEY_ENCRYPTION_KEY` (visible directly in `ci.yml`) — these protect nothing in
production and exist only so the test suite can exercise real encryption/signing code
without needing real secrets.

---

## 1.7 Deployment status

**Not yet deployed anywhere public.** The backend host (Render/Railway/Fly.io) is still
"TBD" — see `Architecture.md` Phase 5 ("Production hardening"). Today, "running the app"
always means running it locally, against the real cloud database.
