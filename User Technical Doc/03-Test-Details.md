# 3. Test Details

*Written for a beginner. Read `01-Environment-Details.md` and
`02-Functional-Code-Workflow.md` first if you haven't.*

"Testing" here actually means **four different kinds of checks**, plus a manual QA
process. This document explains what each one is for, how to run it yourself, and — since
this app was largely built via AI-assisted ("vibe coding") development — *why testing
matters even more* in that workflow.

---

## 3.1 Why bother with automated tests at all (especially for vibe-coded projects)

When code is written quickly, often by an AI assistant, on your behalf, **automated tests
are the main thing that lets you trust a change didn't quietly break something else** you
weren't looking at. A test is a small script that:

1. Sets up a known starting situation (e.g. "a user with $10,000 in AAPL stock"),
2. Runs one piece of code (e.g. "calculate the portfolio's total value"),
3. Checks the result is *exactly* what's expected,
4. And fails loudly, immediately, if it isn't.

The practical benefit: every time a change is made anywhere in this codebase, **hundreds
of these small checks re-run automatically** (see CI, below) — so a change to, say, the
CSV parser can't silently break the Dashboard's math without something turning red first.

---

## 3.2 The four kinds of automated tests

| Kind | Tool | Where | Tests what |
|---|---|---|---|
| **Backend unit/integration tests** | Jest | `backend/tests/*.test.ts` | Every service function and controller — e.g. "does `parseGenericCsv` correctly handle a row with a missing price?", "does `POST /portfolios/:id/import` reject a request with no login cookie?" |
| **Frontend component tests** | Vitest + Testing Library | `frontend/src/**/*.test.tsx` | Individual React components and pages — e.g. "does `HoldingsTable` switch to card view below a certain screen width?", "does the login form show an error on bad credentials?" |
| **Python tests** | pytest | `analysis-service/tests/` | The scoring math in `app/scoring/*.py` — e.g. "does the momentum score match this known input/output pair, ported directly from the original TypeScript version's own test fixtures?" |
| **End-to-end (E2E) tests** | Playwright + Cucumber | `e2e/features/*.feature`, `e2e/steps/*.ts` | Full user journeys through a *real, running* app and a *real* (but dedicated test-only) database — e.g. "can a brand-new user sign up, log in, create a portfolio, import a CSV, and see correct KPI numbers on the Dashboard?" |

**Unit/component/Python tests** are fast (seconds), run against fake/mocked data, and
check one small piece of logic in isolation. **E2E tests** are slower (they open an actual
browser), but they're the only kind that proves the *whole stack* — frontend, backend, and
database — genuinely works together, the way a real user would experience it.

### How to run each one yourself

```bash
# Backend (from backend/)
npm test              # run once
npm test -- --watch   # re-run automatically as you edit

# Frontend (from frontend/)
npm test

# Python analysis-service (from analysis-service/)
poetry run pytest

# End-to-end (from e2e/) — needs the backend+frontend actually running,
# and E2E_DATABASE_URL / e2e/.env.e2e pointed at the dedicated test DB
npm test
```

Each service also has `typecheck` and `lint` scripts (`npm run typecheck`, `npm run
lint`) — these aren't "tests" in the strict sense, but they catch a large class of bugs
(wrong types, unused variables, obvious mistakes) even faster than a test would, without
needing to write one.

---

## 3.3 What Continuous Integration (CI) enforces automatically

Covered in more detail in `01-Environment-Details.md` §1.6 — the short version: every push
and pull request to `master` automatically runs all four suites above in parallel on
GitHub's servers. The `backend`, `frontend`, and `analysis-service` jobs are **hard
gates** — if any test fails, or `typecheck`/`lint` fails, that's flagged clearly. The `e2e`
job currently runs too, but is marked non-blocking (`continue-on-error: true`) until it's
proven stable across enough runs to fully trust — a deliberate, temporary safety valve, not
a decision to skip E2E long-term.

---

## 3.4 Manual testing — `Manual-TestScript/`

Not everything is covered by an automated test yet. Some features are new enough, or
involve enough real-world judgment (does this *look* right in the browser? does this
third-party API actually behave the way the code assumes?), that they get a **hand-written
QA checklist** instead — a step-by-step script a human follows, clicking through the real
app, confirming each expected outcome by eye.

These live in `Manual-TestScript/` as Markdown files, one per feature. Currently:

- **`portfolio-upload-flex-test-plan.md`** — the QA plan for the Flex upload feature
  described in `02-Functional-Code-Workflow.md` §2.5. Covers scenarios across different
  user roles/permissions (Legacy-only user, Flex-permitted user, admin doing template
  approval), since RBAC-gated behavior is hard to fully exercise with a single automated
  test account.

**When to reach for a manual test script instead of an automated test**: right after a
feature is first built and verified live (as most features in this repo's history have
been — see `Architecture.md`'s "verified live" notes throughout), *before* deciding which
parts are worth the effort of a permanent automated E2E scenario. Not every manual check
needs to graduate into an automated one — some are genuinely one-time "does this actually
work against the real FMP API" sanity checks.

---

## 3.5 A note on "verified live"

Throughout this project's build history (see `Architecture.md` and `CLAUDE.md`), you'll
see the phrase **"verified live"** a lot. This means: beyond passing automated tests
(which often use fake/mocked data), someone actually ran the real app against the real
CockroachDB Cloud database and real third-party APIs (FMP/Finnhub), and confirmed the
feature worked end-to-end with real data. This has caught several real bugs that mocked
tests couldn't have caught — for example, an external API returning data in a shape
subtly different from what the code assumed. **Passing tests proves the code does what the
tests describe; "verified live" proves the tests described the right thing.** Both matter,
and neither substitutes for the other.

---

## 3.6 Current state (as of 2026-08-15)

- All four CI jobs (backend, frontend, analysis-service, e2e) have been green together at
  least once (see `CLAUDE.md`'s "Contrarian Finder Stock Universe" entry).
- The current uncommitted branch (`analysis-service/scaffolding`) contains the Flex
  upload feature (built + automated-tested + verified live back on 2026-08-07/14), which
  is now going through its manual QA pass using `Manual-TestScript/
  portfolio-upload-flex-test-plan.md` — that pass is in progress, not yet complete.
- Known gap: the `analysis-service/Dockerfile` has never actually been built/run, because
  Docker isn't installed on the current dev machine — only the plain `poetry run uvicorn`
  path has been tested. This isn't invisible risk being ignored — it's tracked explicitly
  in both `Architecture.md` and `CLAUDE.md` as a known, deliberate gap to close before any
  real deployment.
