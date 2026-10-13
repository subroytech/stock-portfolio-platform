# User Manual — Roles, API Key Access, Contrarian Finder Retention, Portfolio Upload, Config Properties, Login-as, Account Security & Candlestick Pattern Q&A

This document describes the platform's role/permission model — as it relates to FMP/Finnhub/
Anthropic API keys (who manages their own key, who doesn't, and how the app still works for the
people who don't), to the Contrarian Finder shared last-scan result, to portfolio import, to the
admin-configurable Config Properties framework, to the `admin-master`-only Login-as
troubleshooting tool, to registration/password/account-recovery, and to the Candlestick Charts +
Pattern Q&A feature. **Status: implemented and
live-verified (2026-08-02 for the API key sections; 2026-08-05 for Contrarian Finder retention;
2026-08-07 for Portfolio Upload — Flex; 2026-08-24 for Config Properties; 2026-08-27 for the Flex
guided stepper, footer/cash row markers, and template-governance admin tools; 2026-08-28 for
Login-as, with its own live two-account walkthrough closed out on 2026-09-12 — see that section
below; 2026-08-30 for Registration, Password Policy & Security Questions, including
the selectable-questions and post-login Manage Security Questions follow-ons; 2026-08-31 for
Contrarian Finder Run History; 2026-09-06 for the User Usage Dashboard, retroactively documented
here on 2026-09-07 alongside its Monthly-tab aggregation rework; 2026-09-07 for the Stock
Analysis tab; 2026-09-12 for the Dashboard sub-tab's independently-controlled charts; 2026-09-20
for extending bring-your-own + Admin-Master Fallback to a third provider, Anthropic; 2026-09-26
through 2026-10-03 for Candlestick Pattern Detection's full 4-tier/34-pattern build-out and the
Candlestick Pattern Q&A module, documented here for the first time on 2026-10-03).** Role names
below use the exact casing as created in the database: `user-contra-withKey` (capital K),
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
  `subrataroygcp@gmail.com`, which already holds an FMP, a Finnhub, and (2026-09-20) an
  Anthropic key). Its entire purpose is to hold the **shared fallback key**: any user whose
  role is `user`, `admin`, or `user-contra-wokey` and who has no key of their own on file gets
  `admin-master`'s key used on their behalf instead of hitting a `503`. Confirmed a full
  superset of `admin` — it holds every permission `admin` has (full Admin Console access,
  user/role/permission/function management) *plus* being the anointed fallback-key holder, not
  a narrowly-scoped role. Single-account-ness is an **operational convention, not
  code-enforced** — no uniqueness constraint exists; the app trusts the admin not to promote a
  second user to this role. The stored key can be any/all of FMP, Finnhub, and Anthropic, same
  as any other key-holding role — no special-casing needed, the existing `users_subscriptions`
  schema already supports it (`provider` is a plain string column, no allowlist beyond the
  application-level check in `userSubscription.controller.ts`).

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

## Contrarian Finder — Run History (view archived runs)

**Status: implemented and live-verified 2026-08-31.** Unlike the single-latest-run view above,
browsing *older* archived runs is a genuinely gated feature — invisible and unusable for a role
until an `admin` or `admin-master` explicitly grants it `contrarian_finder:view_history` via the
Admin Console's Manage Permission screen. Nothing is pre-granted; this is a deliberate departure
from `contrarian_finder:scan`/`last-scan`'s "viewing isn't the gated action" precedent above,
per an explicit request that Run History specifically stay opt-in per role.

A role with the permission sees a small "🕘 View archived runs" link on the Contrarian Finder
page (next to the "Last scan used" caption, or on its own if no live scan has been seen yet in
that browser tab), opening a Run History panel listing every stored run — both admin-tier
history and any user-tier "my last scan" rows, newest first, regardless of who ran them or
which retention tier they belong to. Selecting one shows that run's own results in a clearly
labeled "archived run" view (an amber banner names the run's date and doesn't let it be mistaken
for the live default view) — filtering by the drop-threshold and switching between Candidates/
Strength List both keep working against the archived data. "Back to current run," or simply
starting a new scan, immediately restores the live default view; nothing about browsing an
archived run ever alters what a viewer without this permission sees.

Unlike `contrarian_finder:scan_history`, `view_history` has **no parent-permission dependency**
— a role can be granted it independently of whether it also holds `contrarian_finder:scan`,
since viewing history and running a scan are unrelated capabilities. It's also **not**
admin-master-restricted the way `config_properties:manage`/`users:impersonate` are — any role
holding `permissions:manage` (i.e. `admin` or `admin-master`) can grant it to any other role.

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

**Extended to a third provider, 2026-09-20**: Candlestick Pattern Q&A's free-text Ask now
resolves the caller's `anthropic` key through this exact same `getDecryptedKey(userId,
'anthropic')` call, with no new fallback logic — a role already on the
`api_key_fallback_eligible_roles` Config Property list gets Anthropic fallback automatically
the moment `admin-master` has their own Anthropic key on file. `anthropicClient.service.ts`
takes the resolved key as an explicit per-call argument rather than caching one client, so
different callers' requests can never cross-use each other's key.

**Spend control, not yet built**: unlike FMP/Finnhub, an Anthropic key is real, metered dollar
cost per question rather than a plan-tier quota, so before loading a real balance onto the
account the platform owner asked whether the app could show `admin-master` the account's
remaining $ balance. Confirmed no such query exists in Anthropic's API (Console-only, human
read) — see `Requirements/Candlestick-Pattern-Q&A-Module-Requirements.md` Section 9.4/11.9 for
the full finding and the recommended self-tracked budget-cap alternative, which has not been
built yet.

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

**Status: implemented and test-covered 2026-08-28; live-verified end-to-end 2026-09-12** with
two real accounts — confirmed the banner and Dashboard genuinely reflect the target's own data
(not a cached admin view), "Return to my account" restores the admin-master session cleanly,
and the audit row described below gets a non-null `ended_at` after returning (checked directly
against the database).

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

## User Usage Dashboard (Admin Console — "User Usage")

**Status: implemented and live-verified, 2026-09-06; the Monthly tab's aggregation reworked and
re-verified 2026-09-07; the Dashboard sub-tab added and redesigned with independently-controlled
charts, 2026-09-09 through 2026-09-12.** Like Contrarian Finder Run History above, browsing usage
data is a genuinely gated feature — invisible and unusable for a role until an `admin` or
`admin-master` explicitly grants it `usage_audit:view` via the Admin Console's Manage Permission
screen. Nothing is pre-granted, and it is **not** admin-master-restricted — any role holding
`permissions:manage` can grant it to any other role, the same "Admin or Admin-Master" precedent as
`contrarian_finder:view_history`.

A role with the permission sees a "User Usage" tab with three sub-tabs:

- **Dashboard** (the landing sub-tab) — two rows, Non-Admin Users and Admin/Admin-Master, split by
  each user's actual roles. Each row has 3 charts, and **every one of the 6 charts has its own
  independent control** — one card can show Today's activity while another shows last month's,
  with no shared picker between them:
  - A pie chart with a period picker (Last 3 Days / Today / Yesterday / Day Before Yesterday).
  - A pie chart with a month picker.
  - A bar chart (one bar per user) with a single control combining both the day-based options and
    any available month. Since users are identified by email — too long to fit as axis labels —
    bars are identified by hovering for a tooltip or reading the color-coded legend below the
    chart, not by reading the axis directly.

  Every chart's slices/bars are sized by that user's combined FMP + Finnhub call volume for
  whatever period is selected.
- **Last 3 Days** — always live: every user ranked by real API-call volume (FMP/Finnhub calls
  actually made) over the last rolling 3 days, split out separately by provider, alongside a
  separate Function Calls count (how many times a feature was invoked, regardless of how many
  real API calls each invocation cost). A zero-usage user still appears, at the bottom, rather
  than being hidden.
- **Monthly** — a month picker plus the same ranking, but only ever reflecting activity through a
  stated cutoff shown at the top of the tab ("this tab's data reflects cumulative call details
  until `<date/time>`"), always a few days behind the current moment by design: a daily
  background job rolls the last 3 days' worth of raw activity into the Monthly totals once a day,
  rather than updating them the instant each action happens — deliberately, since updating a
  reporting/audit view in real time on every single feature call was judged unnecessary overhead.
  (This sub-tab's own month picker is separate from the Dashboard sub-tab's per-chart pickers —
  changing one does not affect the other.)

## Stock Analysis Tab

**Status: implemented and live-verified, 2026-09-07.** A new top-level "Stock Analysis" tab —
four independent, always-visible ticker lookups side by side, each showing the same price
chart/period-return view as the existing standalone Stock Preview popup elsewhere in the app.
Gated by `stock_analysis:view`, zero default grants, same "Admin or Admin-Master can grant to any
role" pattern as `usage_audit:view` and `contrarian_finder:view_history` above — hidden entirely
from the nav for a role without it (not merely disabled), with a direct-URL guard as well, the
same treatment already given to Admin/API Keys. Each of the 4 lookups is independent and
remembered for the rest of your browser session (picking a ticker in one slot doesn't affect the
other three, and reloading the page keeps all 4 where you left them).

## Support Tickets

**Status: implemented and live-verified, 2026-09-05; requester identity and an unread-reply
indicator added 2026-09-18.** A "Support" link, visible to every signed-in user regardless of
role, opens a small ticket-submission/view panel — the only in-app way to reach an admin, and the
only one reachable while a self-registered account is still under review. Any user can create a
ticket, see their own tickets, and reply to keep a conversation going; replying to a ticket that
was previously closed or on hold reopens it automatically.

Only a role holding `support:manage` (granted the same way as any other Admin Console permission —
`admin`/`admin-master` can grant it to any role) sees the admin-side Support Tickets screen:
every user's tickets, filterable by status, with the ability to reply and change status. That
screen now shows **who each ticket is from** (the requester's email, next to the subject) — a real
gap before 2026-09-18, when only the ticket's own content was visible.

On the user side, the "Support" link now carries a small red badge with a count, the moment a new
reply from an admin arrives — mirroring the count badge an admin already sees next to their own
name for brand-new tickets awaiting a first response. The badge (and the same indicator next to
each individual ticket) clears the instant you open that ticket; sending your own reply also
clears it, since it means you've caught up on everything up to that point.

## Stock Analysis — Candlestick Charts

**Status: implemented and live-verified across three rounds, 2026-09-18.** A "Candlestick Charts"
panel on the left side of the Stock Analysis tab, alongside (not replacing) the 4 preview
quadrants above — gated by the same `stock_analysis:view` permission as the rest of that tab.

The panel lists every symbol anyone has already looked up (shared across all users — green means
looked up within the last 10 minutes, grey means still viewable but not brand-new), plus a field
to look up any new symbol. Clicking a symbol — or entering a new one — opens a full-screen chart:

- **Six timeframes** to choose from: 5 Minute, 15 Minute, 30 Minute, 1 Hour, 4 Hour, and 1 Day.
  Switching between them is instant if that timeframe has already been looked up recently; if not,
  you'll see a prompt to fetch fresh data rather than an automatic (and costly) fetch.
- **Nine toggleable indicators**, shown as small buttons above the chart: Moving Averages,
  Bollinger Bands, VWAP, Pivot Points, Fibonacci, RSI, MACD, and — added in the third round —
  **Volume MA** and **OBV**. Volume MA smooths out the Volume panel's day-to-day spikes into a
  trend line; OBV (On-Balance Volume) is a running tally that rises on days price closes higher
  and falls on days it closes lower, shown on its own left-side scale under the Volume bars —
  useful for spotting when trading volume and price direction start to disagree.
- A **Fresh/Stale** badge and "Pulled `<time>`" caption show how current the displayed data is; a
  **Refresh** link appears once data goes stale, and the initial fetch for a never-looked-up
  symbol/timeframe always requires an explicit click — nothing fetches automatically.

**Fetching fresh data is rate-limited per user** — a shared budget across every symbol and
timeframe you look up, admin-configurable (Admin Console → Config Properties → "Stock Analysis
Rate Limits" → **User's Max New Requests** / **User's API Rate Limit Window (Minutes)** — renamed
from their original "Candlestick..." labels 2026-09-19, in anticipation of this same limit
eventually covering more than just this one feature). Merely opening the chart, or switching to a
timeframe that's already been looked up recently, never counts against this limit — only the
explicit "Fetch fresh data"/"Refresh" action does.

### Switching symbols without closing the chart

**Status: implemented and live-verified, 2026-09-29.** The chart's header, which used to show the
symbol as plain text, is now a dropdown (click the ticker + ▾) — pick a different symbol from the
same cached list the left-hand panel shows, or type a brand-new one, without closing the full-screen
chart first. Switching keeps your current timeframe, active indicators, and pattern-picker
selections exactly as they were — it does **not** reset to the 1 Day/default view the way opening a
fresh chart from the left-hand panel does.

### Pattern Detection

**Status: implemented and live-verified across many rounds, 2026-09-26 through 2026-10-03.** Below
the price chart, the app automatically scans the displayed candles for candlestick patterns,
grouped into 4 tiers by how many candles each pattern takes to recognize — deliberately a rule you
can reason about ("more candles to track = harder to use correctly"), not an arbitrary difficulty
label:

| Tier | Candles | Chart badges | Shown |
|---|---|---|---|
| **Simple** | 1 | 9 (Doji and its 3 sub-types, Hammer, Shooting Star, Marubozu, Spinning Top, Belt Hold) | Always on |
| **Composite** | 2 | 10 (Engulfing, Harami, Piercing Line/Dark Cloud Cover, Tweezer Bottom/Top, Kicking) | On demand |
| **Advanced** | 3 | 12 (Morning/Evening Star, Three White Soldiers/Black Crows, Three Inside/Outside Up/Down, Abandoned Baby, Tasuki Gap) | On demand |
| **Complex** | 5 | 2 (Rising/Falling Three Methods) | On demand |

(Pattern Q&A below has one additional entry, **Hanging Man** — the exact same shape as Hammer, so
it has its own curated write-up but shows on the chart as a plain Hammer badge, since telling the
two apart requires knowing the preceding trend, which this chart's geometry-only detection
deliberately doesn't attempt.)

The Simple tier's badges are always visible; the other three tiers are **off by default** — a
"Pattern:" control above the chart groups all 4 pickers in one place, each with a checkbox list of
that tier's own patterns (and an "All" checkbox to toggle every pattern in that tier at once).
Checking a pattern shows it as a small colored badge directly under the candle where it completed;
hovering a badge draws a connector line up into the price chart so you can see exactly which
candle(s) it's pointing at, and the badge's own tooltip shows that candle's real Open/High/Low/
Close. Bullish-leaning badges are green, bearish-leaning ones are red, and badges whose meaning
depends on which candle they're attached to (Doji family, Marubozu, Belt Hold) use a neutral gray.
Every badge's 2-character label always fits: the full pattern name is in its tooltip, and the exact
same pattern name is what you'll find if you look it up in Pattern Q&A below.

## Candlestick Pattern Q&A

**Status: implemented and live-verified, 2026-09-20 through 2026-10-03.** A single permission,
`candlestick_question_answer:ask`, gates the whole feature — viewing/browsing and asking your own
question both require it, zero default grants, same "Admin or Admin-Master can grant to any role"
pattern as Stock Analysis/Usage Audit. Reached via the "Pattern Q&A →" link on the Candlestick
Charts panel, or "Ask about patterns →" inside an open chart (which closes the chart and takes you
there, since patterns aren't tied to one specific symbol). There are two completely independent
ways to get an answer:

### Browse Curated Questions

A searchable table of **every pattern's pre-written Q&A**, organized the same way a textbook
chapter would be — each pattern has exactly 5 questions, one per category:

1. **Definition** — "What is a _ pattern?"
2. **Interpretation** — what the pattern suggests about the shift in buying/selling control
3. **Reliability** — what makes a real occurrence of it more or less trustworthy
4. **How to Use** — how it's typically acted on in practice
5. **Common Mistakes** — the most common way people misread or misapply it

Clicking a question expands its answer inline, directly underneath — including a small diagram of
the pattern's shape where one exists (every pattern currently has one). The table can be filtered by
**Pattern**, **Complexity** (Simple/Composite/Advanced/Complex, same 4 tiers as the chart), and
**Category**, or searched by typing any pattern name or keyword. Browsing is instant and free —
nothing here ever calls an LLM.

### Ask Your Own Question

A free-text box for a question not already covered by the curated table above. Pick a **Trading
Horizon** first — **Day-Trading**, **Swing Trading**, or **Long-Term Investment** — since the
answer is scoped to that horizon's own curated content (a pattern's write-up can be tagged relevant
to one, two, or all three horizons; asking from a horizon a pattern isn't tagged for means that
pattern's content won't be considered). Behind the scenes, your question goes through a real
multi-step search: the LLM searches the curated knowledge base (possibly more than once, refining
its search), then either synthesizes an answer strictly from what it found, or tells you plainly
that the curated content doesn't cover your question — it is **never** allowed to answer from its
own general knowledge, and never gives personalized trading advice on top of pattern education.

**Rate-limited per user** — a shared budget across every question you ask, admin-configurable
(Admin Console → Config Properties → "Candlestick Q&A" group — currently 10 questions per rolling
10-minute window; `admin`/`admin-master` are exempt entirely). The button's own label currently
says "uses 1 of your daily limit," which is a holdover from an earlier design — the real window is
the shorter, admin-configurable one described above, not a calendar day. Browsing curated
questions never counts against this limit, only asking your own does.

### Managing the curated content (admin)

A separate permission, `candlestick_question_answer:manage_content`, controls a small Admin Console
screen for adding new patterns and their curated Q&A entries directly (content created this way is
Approved immediately — there's no pending-review queue for admin-authored content today). This is
how every pattern described in the Pattern Detection section above got its curated write-up and
diagram in the first place.

## Known leftover, not cleaned up yet

`m_function_master` also has an orphaned `apiKeys:bringMyOwn` entry (and a matching
`m_role_permissions` grant on `user-contra-withKey` and `admin-master`) from an earlier,
abandoned attempt at this same feature, predating `api_keys:manage_own`. It isn't checked by
any route and is harmless, but it's dead catalog data. Left in place pending a decision on
whether to remove it via the Manage Functions screen.
