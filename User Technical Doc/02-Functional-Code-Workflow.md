# 2. Functional Code Workflow

*Written for a beginner. Read `01-Environment-Details.md` first if you haven't — this doc
assumes you know what the frontend/backend/analysis-service split is.*

This document explains **how a click in the browser turns into a database change (or an
answer), and how the code is organized so that's traceable.** It ends with two full
walk-throughs of real features.

---

## 2.1 The layering pattern (used almost everywhere in the backend)

Nearly every backend feature is built out of the same four layers, always in this order:

```
Route  →  Middleware  →  Controller  →  Service  →  Database / external API
```

| Layer | Lives in | Job | Analogy |
|---|---|---|---|
| **Route** | `backend/src/routes/*.routes.ts` | Declares "this URL + this HTTP verb exists" and which controller function handles it | A street address |
| **Middleware** | `backend/src/middleware/*.ts` | Code that runs *before* the controller, on every matching request — checks "is this user logged in?", "are they allowed to do this?", "are they sending too many requests?" | A security guard at the door |
| **Controller** | `backend/src/controllers/*.controller.ts` | Reads what the browser sent, calls the right service function, and shapes the response (success JSON, or the right error code) | A receptionist — takes your request, hands it to the right department, brings back the result |
| **Service** | `backend/src/services/*.service.ts` | The actual logic: SQL queries, calls to FMP/Finnhub, calls to the Python service, calculations | The department that actually does the work |

**Why split it up this way, instead of one big function?** Each layer only knows about the
layer directly below it. A controller never writes raw SQL. A service never reads
`req.headers`. This means:
- You can test a service's logic (e.g. "does this discount math work?") without needing a
  fake HTTP request at all.
- Changing *how* something is stored (a new table, a different query) never requires
  touching the route or controller.
- Every route's security rule is visible in one place — `app.ts` — instead of buried
  inside individual functions.

You can see this pattern declared explicitly in `backend/src/app.ts`, where every route
group is wired up like:

```ts
app.use('/portfolios', requireAuth, rateLimiters, portfolioRoutes);
```

Read right-to-left-to-right: *any* request to `/portfolios/...` first passes through
`requireAuth` (must be logged in), then `rateLimiters` (not making too many requests), and
only then reaches `portfolioRoutes`, which routes it to the specific controller function
for that exact URL.

---

## 2.2 The frontend's matching pattern

The frontend mirrors this same idea, just with different names:

| Layer | Lives in | Job |
|---|---|---|
| **Page** | `frontend/src/pages/*.tsx` | One file per screen — assembles components, decides what's shown |
| **Component** | `frontend/src/components/*.tsx` | A reusable, self-contained piece of UI (a table, a chart, a modal) |
| **API function** | `frontend/src/api/*.ts` | The *only* place that actually calls `fetch()` against the backend — one file per feature area |
| **lib helper** | `frontend/src/lib/*.ts` | Pure logic with no UI and no network call (e.g. `kelly.ts`'s position-sizing math, `csvHeaders.ts`'s header-normalizing) |

Pages never call `fetch()` directly — they call a function from `api/`, wrapped in
**TanStack Query** (`useQuery`/`useMutation`), which handles loading states, caching, and
re-fetching automatically.

---

## 2.3 Authentication & authorization, in plain terms

These are two different questions the app answers separately:

- **Authentication ("who are you?")** — Signup/Login (`POST /auth/signup`, `POST
  /auth/login`) hash the password with **bcrypt** (so the real password is never stored),
  and on success issue a **JWT** (a signed token proving "this is user #42") stored in an
  **httpOnly cookie** — a cookie JavaScript in the browser can't read or tamper with,
  which protects against a common attack (XSS token theft). Every subsequent request
  automatically carries this cookie; the `requireAuth` middleware checks it's present and
  valid before letting the request through.

- **Authorization ("are you allowed to do *this specific thing*?")** — This is a full
  **RBAC system** (Role-Based Access Control): every user has one or more **roles**
  (`admin`, `user`, `admin-master`, `user-contra-withKey`, ...), each role has a set of
  granted **permissions** (`contrarian_finder:scan`, `portfolio_upload:flex`, `roles
  :manage`, ...), and each permission is tied to a specific backend **function**. The
  `requirePermission('some:permission')` middleware checks the *database* for whether the
  logged-in user's role(s) actually grant that permission — nothing is hardcoded like "if
  role === 'admin'". This is why new permissions can be added, and granted/revoked per
  role, entirely from the Admin Console UI, with no code changes.

  The frontend mirrors this for UI purposes only (hiding buttons/tabs a user can't use) —
  but the *real* enforcement always happens on the backend, since a user could otherwise
  just call the API directly and skip the UI.

- **"Login-as" (impersonation)** — a special, narrower case of authentication: a single
  `admin-master` account (and only that role — enforced backend-side, not just hidden in
  the UI) can temporarily *become* another user for troubleshooting, without their
  password. Under the hood, the same JWT gains one extra field, `impersonatedBy` (the
  admin's own id) — there's no second cookie or session store, just one token that can
  prove both "who you're acting as" and "who's really behind the wheel." These sessions
  expire much sooner than a normal login (`IMPERSONATION_EXPIRES_IN`, default `1h` vs. the
  normal `7d`), and impersonating another admin is blocked outright — this is a support
  tool, not a privilege-escalation path.

- **Self-registration and the `'pending'` gate** — public signup (`POST /auth/signup`) now
  collects a full name and a 15-25 character password meeting several rules (see
  `backend/src/utils/passwordPolicy.ts`), plus answers to 5 personal security questions the
  user picks themselves (reduced from 7, 2026-08-30 — see `auth.controller.ts`'s
  `REGISTRATION_QUESTION_COUNT`). The new account is created with `status: 'pending'` and,
  unlike the old signup, is **not** given any role. `login()` deliberately still lets a
  `'pending'` account authenticate (get a valid cookie) — it's the frontend's
  `ProtectedRoute.tsx` that renders nothing but a "your registration is under review" page for
  such a session, until an admin assigns a role and flips the status to `'active'` via Manage
  Users. Forgot Password reuses those same 5 security questions instead of an email link (this
  repo has no email-sending capability) — 3 are randomly challenged (`CHALLENGE_QUESTION_COUNT`),
  all 3 must match.

---

## 2.4 Walk-through #1: Logging in

A concrete trace through every layer, for the simplest possible feature.

1. **Browser**: user types email/password on `LoginPage.tsx`, clicks Login.
2. **Frontend API layer**: `frontend/src/api/auth.ts`'s `login()` function sends `POST
   /auth/login` with the credentials.
3. **Backend route**: `auth.routes.ts` maps `POST /login` (mounted at `/auth` in `app.ts`)
   to `auth.controller.ts`'s `login` function. Note this route is *not* behind
   `requireAuth` — you can't require a login to... log in.
4. **Controller**: reads `req.body.email`/`req.body.password`, calls
   `auth.service.ts`'s `loginUser()`.
5. **Service**: looks up the user row by email, uses `bcrypt.compare()` to check the
   password against the stored hash, and if it matches, signs a JWT with
   `jsonwebtoken`.
6. **Controller**: sets that JWT as an httpOnly cookie on the response, and sends back the
   user's basic profile.
7. **Frontend**: TanStack Query's mutation succeeds, the app redirects to the Dashboard.
   Every future request from this browser tab now automatically includes that cookie.

---

## 2.5 Walk-through #2: Uploading a portfolio via "Flex" (the newest, most complex feature)

Flex is worth walking through because it touches almost every part of the system at once:
multiple pages, a multi-step wizard, template governance, and RBAC.

**The problem Flex solves**: the original ("Legacy") importer only understands a few
specific brokers' exact CSV formats. Flex lets a user upload *any* CSV/Excel file with a
header row, manually map its columns to the app's fields once, and reuse that mapping
("template") automatically on every future upload.

**The flow:**

1. User picks **Portfolio → Flex** (a sub-tab only visible if their role has the
   `portfolio_upload:flex` permission — enforced both by the frontend hiding the tab *and*
   the backend rejecting the request if bypassed).
2. **New mapping path**: they upload a file. `ColumnMappingWizard.tsx` reads its header
   row and shows it next to the app's required fields (Symbol, Quantity, Current Price)
   and optional ones (Purchase Price, Name, Sector, Purchase Date). The user drags/matches
   each one.
3. **"Inspect Data"** — a pure in-memory preview, no database writes yet. This calls `POST
   /portfolios/flex` with `dryRun: true`, which routes to `portfolioTemplate.controller.ts`
   → `flexParser.service.ts`'s `parseFlexCsv()`, which reuses the *exact same* row-parsing
   logic (`buildHoldingsFromMappedRows()`) that the Legacy importer uses — just fed a
   user-defined mapping instead of the Legacy importer's built-in header aliases. Shows a
   top-5-row preview.
4. User proceeds for real (no `dryRun`) → `portfolio.service.ts`'s
   `createPortfolioFlex()` actually writes to `tx_portfolios`/`tx_holdings` — the same
   tables and the same downstream code (`importHoldings()`) Legacy already used and had
   tested.
5. The Dashboard renders from that real, freshly-written data.
6. **The forced decision**: the user must now either —
   - **Save Template** — persists the mapping into
     `m_portfolio_template_mapping_master`/`_dtls` at `Pending Approval` status, and marks
     the portfolio `flex_template_status = 'Flex'`. Only an admin can later flip a
     template to `Approved` (visible to other users) or `Rejected`, via
     `PortfolioTemplateApprovalPage.tsx` → `PUT /portfolio-templates/:id/status`.
   - **Delete Portfolio** — if the mapping was wrong, there's no "edit" — just delete and
     retry with a corrected mapping. Nothing wrong is ever saved as reusable.
   - If the user just navigates away without choosing, the portfolio is left flagged
     `flex_template_status = 'Flex-Err'` — a "needs attention" state a banner can detect
     later (`FlexResolutionBanner.tsx`), rather than silently pretending everything's fine.
7. **Later uploads**, once a template is bound, skip the whole wizard — the saved mapping
   is applied automatically.

This single feature demonstrates the general pattern this whole app follows: **Node
(backend) owns all data access and business rules; the frontend is a thin, permission-aware
presentation layer; nothing trusts the frontend's own UI restrictions as actual security.**

**Extended since the walk-through above was written**: real broker files surfaced two more
patterns the wizard needed to handle, so step 2's "map columns" screen actually grew into a
6-step guided sequence — **Header → Footer → Cash → Map Columns → Inspect Data → Confirm
Mapping** — with a visible progress-bar stepper, plus two new optional marker steps: a
*footer marker* (click the row where a trailing "Totals"/disclaimer block starts, so it gets
excluded from parsing) and a *cash-row marker* (click the row holding a cash/money-market
balance, either as its own column or embedded inside another cell's text, e.g. `"CASH &
CASH EQUIVALENTS $12,345.67"`). Both are saved as part of the template (`footer_marker_row`,
`cash_config` on `m_portfolio_template_mapping_master`), so a reused template auto-applies
them without re-asking. The Admin Console's Portfolio Templates tab also gained template
hard-delete, a pop-up showing every portfolio still bound to a template before deleting it,
and a section listing any Flex portfolio abandoned mid-flow (`flex_template_status =
'Flex-Err'`) so it's never invisible.

---

## 2.6 Where the Python service fits in

`analysis-service/` (FastAPI) is used only for **pure, stateless number-crunching** — it
never touches the database or calls FMP/Finnhub itself. The pattern is always:

1. A Node service (e.g. `longTermAnalysisData.service.ts`) fetches whatever raw data is
   needed (stock prices, fundamentals) from FMP/Finnhub, using the calling user's own
   stored API key.
2. Node sends that raw data to the Python service over HTTP (e.g. `POST
   /analysis/long-term/:symbol`, proxied through `analysis.controller.ts`).
3. Python (e.g. `app/scoring/long_term.py`) runs the scoring math and returns a result —
   no side effects, same input always gives the same output.
4. Node relays that result back to the frontend.

Three features currently work this way: **Momentum**, **Long-Term Analysis**, and
**Contrarian Finder**'s scoring math. Each was first proven working entirely inside Node,
then had its pure-math portion extracted into Python once the pattern was validated — see
`Architecture.md` for the reasoning behind doing it in that order.

---

## 2.7 Config Properties — changing business rules without a code deploy

Some numbers in this app were originally hardcoded constants in TypeScript — e.g. "keep the
60 most recent admin scan-history rows" or "which roles fall back to the shared admin key."
Changing either used to mean editing code and redeploying. The **Config Properties**
framework moves values like this into the database instead: `admin-master` (and only that
role) can view/change them from the Admin Console's Config Properties tab, and the backend
always reads the *current* value live (no caching, no restart needed) via a small pair of
helper functions, `getConfigInt()`/`getConfigStringList()`. Every change is kept as a full
version history (never overwritten, only superseded), so it's always clear what the value
was at any point in time and who changed it. This is deliberately reusable infrastructure,
not a one-off fix — new tunable values can be added the same way going forward.

---

## 2.8 Feature map — where to look for each screen

| Screen | Frontend page | Backend routes/controller | Backend service(s) |
|---|---|---|---|
| Login/Signup | `LoginPage.tsx`, `SignupPage.tsx` | `auth.routes.ts` | `auth.service.ts`, `securityQuestion.service.ts`, `passwordHistory.service.ts` |
| Change Password / Forgot Password | `ChangePasswordPage.tsx`, `ForgotPasswordPage.tsx` | `auth.routes.ts` (`/change-password`, `/forgot-password/start\|verify\|reset`) | `auth.service.ts`, `passwordHistory.service.ts`, `securityQuestion.service.ts` |
| Manage Security Questions | `ManageSecurityQuestionsPage.tsx` (via the header's user-icon menu, not its own nav tab) | `auth.routes.ts` (`/security-questions`, `/security-questions/mine`) | `securityQuestion.service.ts` |
| Portfolio Dashboard (Legacy) | `DashboardPage.tsx` | `portfolio.routes.ts` | `portfolio.service.ts`, `parser.service.ts` |
| Portfolio Dashboard (Flex) | `FlexPortfolioPage.tsx` | `portfolioTemplate.routes.ts`, `portfolio.routes.ts` | `flexParser.service.ts`, `portfolioTemplate.service.ts`, `portfolio.service.ts` |
| API Keys | (modal, `apiKeysModal.ts`) | `userSubscription.routes.ts` | `userSubscription.service.ts`, `encryption.ts` |
| Contrarian Finder | `ContrarianFinderPage.tsx` | `contrarianFinder.routes.ts` | `contrarianFinder.service.ts` (+ Python `contrarian_finder.py`) |
| Momentum | `MomentumPage.tsx` | `momentum.routes.ts` | `momentum.service.ts` (+ Python `momentum.py`) |
| Long-Term Analysis | `LongTermAnalysisPage.tsx` | `analysis.routes.ts` | `longTermAnalysisData.service.ts` (+ Python `long_term.py`) |
| Contrarian Comeback | `ContrarianComebackPage.tsx` | `analysis.routes.ts` | `contrarianComebackData.service.ts` (+ Python) |
| Admin Console | `AdminPage.tsx` and its sub-pages (`RolesPage`, `RolePermissionsPage`, `UserRolesPage`, `FunctionsPage`, `MasterDataPage`, `PortfolioTemplateApprovalPage`, `ConfigPropertiesPage`) | `roles.routes.ts`, `functionMaster.routes.ts`, `users.routes.ts`, `portfolioTemplate.routes.ts`, `configProperty.routes.ts` | `roles.service.ts`, `functionMaster.service.ts`, `users.service.ts`, `configProperty.service.ts` |
| Config Properties (admin-master only) | `ConfigPropertiesPage.tsx` (an Admin Console tab, not its own route) | `configProperty.routes.ts` | `configProperty.service.ts` |
| "Login-as" (admin-master only) | `LoginAsModal.tsx` + `ImpersonationBanner.tsx` (in `TabShell.tsx`/`AdminPage.tsx`, not their own route) | `auth.routes.ts` (`/auth/impersonate`, `/auth/stop-impersonating`) | `impersonation.service.ts`, `auth.service.ts` |

For the full database structure behind all of this, see `backend/src/db/SCHEMA.md`.
