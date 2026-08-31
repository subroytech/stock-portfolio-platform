# User Manual — Roles, API Key Access, Contrarian Finder Retention, Portfolio Upload, Config Properties, Login-as & Account Security

This document describes the platform's role/permission model — as it relates to FMP/Finnhub API
keys (who manages their own key, who doesn't, and how the app still works for the people who
don't), to the Contrarian Finder shared last-scan result, to portfolio import, to the
admin-configurable Config Properties framework, to the `admin-master`-only Login-as
troubleshooting tool, and to registration/password/account-recovery. **Status: implemented and
live-verified (2026-08-02 for the API key sections; 2026-08-05 for Contrarian Finder retention;
2026-08-07 for Portfolio Upload — Flex; 2026-08-24 for Config Properties; 2026-08-27 for the Flex
guided stepper, footer/cash row markers, and template-governance admin tools; 2026-08-28 for
Login-as, built and test-covered but still pending its own live two-account walkthrough — see
that section below; 2026-08-30 for Registration, Password Policy & Security Questions, including
the selectable-questions and post-login Manage Security Questions follow-ons).** Role names below
use the exact casing as created in the database: `user-contra-withKey` (capital K),
`user-contra-wokey` (lowercase), `admin-master`.

## Roles

| Role | Sees "API Keys" link? | Uses whose key? | Can Run Contrarian Finder Scan? |
|---|---|---|---|
| `user` (default) | No | `admin-master`'s (fallback) | No |
| `admin` | Yes (own, plus full Admin Console) | Own, falls back to `admin-master`'s if none on file | Yes |
| `user-contra-withKey` | **Yes** | Own | Yes |
| `user-contra-wokey` | **No** | `admin-master`'s (fallback) | Yes |
| `admin-master` | Yes | Own (this *is* the fallback key) | Yes |

- **`user-contra-withKey`** — sees the "API Keys" link at login and manages their own key,
  same as today's default bring-your-own-key experience. Granted `contrarian_finder:scan`
  ("Functional Access") in addition to `api_keys:manage_own`.
- **`user-contra-wokey`** — does **not** see the "API Keys" link at all (nothing to manage —
  they have no key of their own, by design), but can still Run Scan and use other
  key-dependent features, because the backend transparently falls back to `admin-master`'s
  key when the calling user has none on file. Granted `contrarian_finder:scan` but **not**
  `api_keys:manage_own`.
- **`admin-master`** — exactly one account across the whole application (currently
  `subrataroygcp@gmail.com`, which already holds both an FMP and a Finnhub key). Its entire
  purpose is to hold the **shared fallback key**: any user whose role is `user`, `admin`, or
  `user-contra-wokey` and who has no key of their own on file gets `admin-master`'s key used
  on their behalf instead of hitting a `503`. Confirmed a full superset of `admin` — it holds
  every permission `admin` has (full Admin Console access, user/role/permission/function
  management) *plus* being the anointed fallback-key holder, not a narrowly-scoped role.
  Single-account-ness is an **operational convention, not code-enforced** — no uniqueness
  constraint exists; the app trusts the admin not to promote a second user to this role. The
  stored key can be either/both FMP and Finnhub, same as any other key-holding role — no
  special-casing needed, the existing `users_subscriptions` schema already supports it.

## Contrarian Finder — shared last-scan result & retention tiers

Every signed-in user, including plain `user` (who can't run a scan at all), can **view** the
most recently completed Contrarian Finder scan — `GET /contrarian-finder/last-scan` has no
permission gate, same reasoning as the Stock Universe reference table. Only the *running* of a
scan is gated by `contrarian_finder:scan` (the table above). This view is always kept fresh:
whichever run is genuinely the newest across every role is what every viewer sees, regardless
of who ran it or how long ago they last opened the page.

How a completed run is stored depends on a second permission, `contrarian_finder:scan_history`,
granted only to `admin` and `admin-master`:

| Role | Runs a scan → | Retention |
|---|---|---|
| `admin`, `admin-master` | Appends to a shared history log | Rolling **60-run** history, oldest pruned automatically |
| `user-contra-withKey`, `user-contra-wokey` | Replaces their own prior run | Exactly **one row per account** — the next run overwrites the last |

`contrarian_finder:scan_history` only has an effect *alongside* `contrarian_finder:scan` — it's
not a separate action a role can take on its own, and the Admin Console's Manage Permission
screen enforces this: granting `scan_history` to a role that doesn't already have `scan` is
rejected, and `scan` can't be revoked from a role while it still holds `scan_history`. In the
Manage Permission checklist, `scan_history` renders indented directly under `scan` to make this
relationship visible at a glance.

## "Functional Access" = `contrarian_finder:scan`

Both `user-contra-withKey` and `user-contra-wokey` are granted "Functional Access," while only
`user-contra-withKey` gets the API-Keys link — confirmed these are two independent
permissions, not one. "Functional Access" is exactly the existing `contrarian_finder:scan`
permission, nothing broader. This doesn't affect Momentum / Long-Term Analysis / Contrarian
Comeback / Refresh Prices — those already have no permission gate at all (open to any
signed-in user); what makes them *work* for a keyless user is the API-key fallback below, not
a functional-access permission.

## API key resolution (the real engineering change)

Every feature that needs a live FMP/Finnhub call (Quotes, Contrarian Finder, Momentum,
Long-Term Analysis, Contrarian Comeback, Portfolio Refresh Prices) already funneled through one
function — `backend/src/services/userSubscription.service.ts`'s `getDecryptedKey(userId,
provider)` — so the fallback lives entirely there, not in any of the 8 call sites:

1. Look up the calling user's own key.
2. If they have one, use it (unchanged from before this feature existed).
3. If they don't, **and** their role is `user`, `admin`, or `user-contra-wokey`, look up
   `admin-master`'s key (a direct query, joining `users_subscriptions` → `users_roles` →
   `m_roles` on `name = 'admin-master'`) and use that instead of failing.
4. If they don't have one and their role isn't in that fallback list (`user-contra-withKey`,
   who is *supposed* to have their own), or the fallback source itself has no key for that
   provider either, still throw `MissingUserApiKeyError` → `503` — no silent fallback beyond
   the one designated `admin-master` account. The error message differs: a fallback-ineligible
   role gets "add one via PUT /subscriptions" (unchanged); a fallback-eligible role whose
   fallback came up empty gets "contact an admin" instead, since they may not even have
   `api_keys:manage_own` to add their own.

## UI visibility rules

- **"API Keys" link/tab** (`TabShell.tsx`'s header button, `AdminPage.tsx`'s "My API(s)"
  tab): visible only for whoever holds `api_keys:manage_own` — `user-contra-withKey`, `admin`,
  `admin-master`. Invisible for `user` and `user-contra-wokey`.
- **"Run Scan"** (`ContrarianFinderPage.tsx`): visible for whoever holds
  `contrarian_finder:scan` — `admin`, `admin-master`, `user-contra-withKey`,
  `user-contra-wokey`. Invisible for plain `user`.

Both gates check the caller's actual resolved permissions (`GET /auth/me`'s `permissions`
array), not a hardcoded role name — a future role gets the same UI behavior automatically the
moment it's granted the matching permission via Manage Permission, no code change needed.

## Portfolio Upload — Flex

**Status: implemented and live-verified, 2026-08-07.**

**What changed for users**: portfolio import now has two RBAC-gated Functions —
`portfolio_upload:legacy` (today's Fidelity/Empower/Robinhood import, unchanged) and
`portfolio_upload:flex` (a new, template-driven import for any file with a header row). Import
previously had no permission gate at all — `user` was granted `portfolio_upload:legacy` by
default on rollout so nobody lost today's import; `portfolio_upload:flex` is admin-granted-only.
`admin`/`admin-master` hold both, plus the new `portfolio_template:manage_status` Admin Console
function (sets a template's approval status). The "Stock Portfolio" tab is now a "Portfolio" tab
with **Legacy** and **Flex** sub-tabs, each hidden entirely for a session without the matching
permission (same as Admin/API Keys). A session with neither permission still sees a read-only
Legacy view rather than a blank tab. Legacy and Flex portfolios are kept strictly separate in
the UI — a Flex-created portfolio never appears in the Legacy sub-tab's selector, and vice
versa, so neither importer is ever pointed at data it doesn't own.

**How Flex templates work**: a template is a saved column mapping (uploaded file's headers →
the app's required portfolio fields), reusable across future uploads instead of re-mapped every
time. Templates go through `Pending Approval` → `Approved`/`Rejected`. A user can use their own
Pending template for their own uploads immediately (pending status only hides it from other
users); the Approved list they see is filtered to templates from Admin, Admin-Master, or
themselves — not a flat everyone-sees-everything pool.

**Creating a new mapping is tied to actually proving it works**: after mapping columns and
passing a quick preview check, the portfolio is created for real and its Dashboard is shown
from genuinely imported data. From there, exactly one of two things must happen — if the
Dashboard looks right, saving the mapping as a reusable template is required (not optional,
since only a real rendered Dashboard is strong enough proof the mapping is actually correct);
if it looks wrong, the fix is deleting that portfolio and trying again with a corrected file.
A portfolio left without either resolution is flagged internally as needing attention until the
user comes back and finishes one path or the other.

### The mapping wizard — a 6-step guided walkthrough

**Status: implemented and live-verified, 2026-08-27.**

Creating a new mapping now walks through six steps, shown as a stepper bar at the top of the
wizard: **Header → Footer → Cash → Map Columns → Inspect Data → Confirm Mapping**. The current
step's own Back/Next/Skip buttons sit to the left of that bar; the step indicators themselves sit
to the right, so it's always clear both where you are and what's still ahead.

- **Header** — confirms which row in the uploaded file is the real header row.
- **Footer (optional, skippable)** — some brokers add a trailing "Totals"/disclaimer block below
  the real holdings rows. If your file has one, click the first row of that trailing block in the
  preview grid to mark it — everything at or below that row is excluded from every future import
  through this template, not just this one. If your file has no such block, click Skip.
- **Cash (optional, skippable)** — some brokers export your cash/money-market balance as its own
  row rather than a normal holding. If your file has one, click that row to mark it, then choose
  how the dollar value is represented:
  - **"Same column"** — the value sits in its own column on that row (pick which one).
  - **"Embedded in another column"** — the value is embedded inside a text cell, e.g. a
    "Description" column containing `"CASH & CASH EQUIVALENTS $12,345.67"` — click the cell
    holding that text and the app extracts the dollar figure automatically.

  If your file has no separate cash row, click Skip.
- **Map Columns** — map the file's detected headers to the app's fields (Symbol/Quantity/Current
  Price are mandatory; Purchase Price/Name/Sector/Purchase Date are optional).
- **Inspect Data** — shows a top-5-record preview of what will actually be imported, including a
  "Cash detected: $X" line if a cash row was configured. **You must scroll this preview fully
  into view before "Use This Mapping" becomes clickable** — a deliberate check to make sure the
  preview actually gets looked at before the real import runs, not skipped past. A short note
  next to the disabled button explains why it's disabled until you've scrolled.
- **Confirm Mapping** — proceeds to the real import and Dashboard, per the "actually proving it
  works" flow described above.

A template saved from this wizard remembers its footer/cash settings along with the column
mapping, so a later upload using the same template applies all three automatically — no need to
re-mark the footer row or re-identify the cash row every time.

### Admin: managing templates and stuck portfolios

**Status: implemented and live-verified, 2026-08-27.** All of the below lives in the existing
Admin Console → Portfolio Templates tab (gated by `portfolio_template:manage_status`, same as
Approve/Reject) — no new menu items.

- **Delete a template** — a `Rejected` or still-`Pending Approval` template (created by mistake,
  or superseded by a better one) can now be permanently deleted. An `Approved` template that's
  actually bound to real portfolios can never be deleted this way — only rejected, going forward.
- **Bound-portfolios pop-up** — attempting to delete a template that's still bound to one or more
  portfolios opens a list of exactly which portfolios (owner + name), each with its own delete
  button right there, instead of just a "can't delete, in use" dead end. Deleting a portfolio
  from this list is the same as deleting it from the Dashboard — permanent, cannot be undone.
- **Unattached Flex Portfolios** — a new section, further down the same tab, listing every Flex
  portfolio that was created but never resolved (the user left before either saving a template or
  deleting the portfolio — the "needs attention" state the original Flex design always allowed
  for, now finally visible somewhere). Each entry can be viewed or deleted from here directly.

## Config Properties (Admin Console)

**Status: implemented and live-verified, 2026-08-24.**

A new "Config Properties" tab in the Admin Console lets `admin-master` change certain
business-tunable values without needing a code deploy — for example, how many admin-tier
Contrarian Finder scan-history rows to keep before pruning the oldest ones (today configured to
`60`, the same default it was hardcoded to before this feature existed). This tab is visible
only to `admin-master` — not even `admin` sees it, the one deliberate exception in this app to
"every permission can be granted to any role via Manage Permission."

**How it's organized**: properties are grouped (e.g. "Data Retention Policies") purely for
browsing — a group isn't tied to a specific file or service. Each property has a type
(`integer` or `string`), and integer properties can optionally have a min/max range; saving a
value outside that range is rejected with a clear error instead of silently accepted. Every
value change is kept in a full history (which version was active when, and who changed it) —
nothing is ever overwritten or deleted, only superseded by a newer version.

**What this is not (yet)**: there's no way to schedule a value change for a future date/time —
every change takes effect immediately. There's also no caching layer, so a change here takes
effect on a service's very next read, not after a restart.

## Login-as (admin-master troubleshooting tool)

**Status: implemented and test-covered, 2026-08-28 — not yet walked through live with two real
accounts. Treat this section as accurate-but-unverified until that walkthrough happens.**

`admin-master` can view the app exactly as a specific user sees it, without needing their
password — a fast way to reproduce a role-specific issue someone reports, without having to ask
them to screen-share or describe every click. This is deliberately **not** available to plain
`admin` — only `admin-master`, and the permission behind it (`users:impersonate`) can only ever
be granted by directly editing the database, never through the Admin Console's Manage Permission
screen.

**How it works**:
1. From the Admin Console header, `admin-master` clicks **"Login as User"** (invisible to
   everyone else, including plain `admin`).
2. A pop-up lists every user, searchable by email. Pick one and confirm.
3. The app immediately switches to that user's identity — same Dashboard, same permissions, same
   data they'd see if they logged in themselves. A banner reading **"You are viewing as
   {email}."** stays pinned near the top of every page for as long as this is active, so it's
   never ambiguous whose account is currently being viewed.
4. Click **"Return to my account"** in that banner at any time to switch back to the
   `admin-master` session cleanly.

**Guardrails**:
- **Another admin can never be impersonated** — attempting to "Login as" any account that itself
  has Admin Console access (another `admin`/`admin-master`) is blocked outright. This tool is for
  seeing what an ordinary user sees, not a way to quietly assume another administrator's access.
- **No nested impersonation** — while viewing as someone else, "Login as" isn't available again;
  return to your own account first.
- **Time-limited automatically** — an impersonation session expires after 1 hour even if never
  explicitly ended (vs. the normal 7-day login), and expiry is handled the same way any other
  expired session is (see below) — a clean re-login prompt, not a confusing error.
- **Every session is logged** — who impersonated whom, when it started, and when it ended, kept
  for 180 days as an audit trail. Not currently viewable from any screen in the app itself.

## Session Expiry & Account Indicator

**Status: implemented and live-verified, 2026-08-27.**

- If your session ever goes stale (rare — a very old login, or reconnecting after a backend
  restart during active development), the app now recognizes this cleanly instead of showing
  scattered errors that can look like the whole service is down: you're returned to the login
  page with a "Your session ended, please log back in" message.
- Every page header now shows a small badge with your initials, next to the Log out button —
  hover over it to see the exact email and role(s) your current session is signed in as. Useful
  whenever more than one account might be in play in the same browser (e.g. testing, or after
  using Login-as above). **Since 2026-08-29, it's also clickable** — opens a small menu with
  "Change Password" and "Manage Security Questions" (see the next section).

## Registration, Password Policy & Security Questions

**Status: implemented and live-verified (2026-08-29 for the core flow; 2026-08-30 for the
selectable-questions/post-login Manage Security Questions follow-on and the 5-question reduction).**

### Registering a new account

The "Register New User" form (linked from the Login page) asks for your email, first and last
name, a password meeting the policy below, and answers to **5 of 15 security questions of your
own choosing** — 5 "Question N" slots, each a dropdown; pick a question in a slot and an answer
box appears beneath it. Each slot's dropdown only offers questions not already picked in another
slot, so you can never accidentally pick the same question twice. These questions are how you'll
prove your identity later if you forget your password — see "Forgot Password" below.

**Your account starts out `Pending`.** You can log in right away, but you won't see anything
except a message confirming your registration is under review — no tabs, no data, nothing
functional — until an admin assigns you a role and activates the account (Admin Console → Manage
Users, the same screen used for everything else account-related). This is a deliberate approval
gate, not a bug: self-registration no longer grants automatic access the way the old signup form
used to.

### Password requirements

Shown as a live checklist while you type (on Registration, Change Password, and the final step of
Forgot Password):

1. 15–25 characters
2. At least 1 uppercase letter
3. At least 1 number
4. At least 1 special character (`! @ # $ % ^ & * ( ) _ - + = ? .`)
5. Doesn't contain your first or last name
6. Doesn't contain 5 or more consecutive characters from your email address
7. Isn't a repeat of any of your last 5 passwords (checked when you submit, not while typing —
   this one needs a database lookup)

The checklist stays neutral (nothing shown as satisfied) until you've typed at least 4 characters
— fixed 2026-08-30 after a report that an *empty* password field was misleadingly showing some
rules as already passed.

### Changing your password (while logged in)

Header → your initials badge → **Change Password**. Enter your current password, then a new one
meeting the policy above.

### Forgot Password

Link on the Login page. Enter your email, then answer **3 randomly-chosen questions** out of the
5 you set up at registration — all 3 must be correct (you won't be told which one was wrong if
you get one incorrect) — then set a new password. No email is sent at any point in this flow;
everything happens on-screen.

### Managing your security questions after registration

Header → your initials badge → **Manage Security Questions**. Shows your current 5 questions
pre-filled into their slots; pick different questions in any slot if you want to change them (a
re-picked question still needs its answer retyped — answers are never stored in a way that can be
shown back to you, even to yourself), and confirm with your current password. This is also how an
account created directly by an admin (which doesn't set up security questions automatically) sets
them up for the first time — without doing this, Forgot Password won't work for that account.

### Known limitations

- There's no email-based account recovery at all — if you forget both your password and your
  security-question answers, an admin has to reset your password manually via Manage Users.
- Forgot Password will tell you outright if an email has no account (rather than staying vague
  about it) — a deliberate simplicity choice, consistent with how the app already behaves
  elsewhere (e.g. registering with an email that's already taken).

## Known leftover, not cleaned up yet

`m_function_master` also has an orphaned `apiKeys:bringMyOwn` entry (and a matching
`m_role_permissions` grant on `user-contra-withKey` and `admin-master`) from an earlier,
abandoned attempt at this same feature, predating `api_keys:manage_own`. It isn't checked by
any route and is harmless, but it's dead catalog data. Left in place pending a decision on
whether to remove it via the Manage Functions screen.
