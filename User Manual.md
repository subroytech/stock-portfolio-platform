# User Manual — Roles, API Key Access, Contrarian Finder Retention & Portfolio Upload

This document describes the platform's role/permission model — as it relates to FMP/Finnhub API
keys (who manages their own key, who doesn't, and how the app still works for the people who
don't), to the Contrarian Finder shared last-scan result, and to portfolio import. **Status:
implemented and live-verified (2026-08-02 for the API key sections; 2026-08-05 for Contrarian
Finder retention; 2026-08-07 for Portfolio Upload — Flex).** Role names below use the exact
casing as created in the database: `user-contra-withKey` (capital K), `user-contra-wokey`
(lowercase), `admin-master`.

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

## Known leftover, not cleaned up yet

`m_function_master` also has an orphaned `apiKeys:bringMyOwn` entry (and a matching
`m_role_permissions` grant on `user-contra-withKey` and `admin-master`) from an earlier,
abandoned attempt at this same feature, predating `api_keys:manage_own`. It isn't checked by
any route and is harmless, but it's dead catalog data. Left in place pending a decision on
whether to remove it via the Manage Functions screen.
