# User Manual — Roles & API Key Access

This document describes the platform's role/permission model as it relates to FMP/Finnhub API
keys — who manages their own key, who doesn't, and how the app still works for the people who
don't. **Status: implemented and live-verified (2026-08-02).** Role names below use the exact
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

## Known leftover, not cleaned up yet

`m_function_master` also has an orphaned `apiKeys:bringMyOwn` entry (and a matching
`m_role_permissions` grant on `user-contra-withKey` and `admin-master`) from an earlier,
abandoned attempt at this same feature, predating `api_keys:manage_own`. It isn't checked by
any route and is harmless, but it's dead catalog data. Left in place pending a decision on
whether to remove it via the Manage Functions screen.
