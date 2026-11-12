# Usage Audit Follow-ons + Flex Portfolio Quota UX Polish: Manual Test Plan

Covers two independent pieces built together (see `federated-foraging-mitten.md` plan):
**Part A** — real per-provider API call tallies for Momentum/Long-Term Analysis/Contrarian
Comeback (previously logged a plain `1` regardless of actual call volume). **Part B** — a
live quota-status indicator + pre-submission guard for Flex Portfolio's 3 caps (pending
templates, approved templates, Flex portfolios), replacing the old "just wait for the 409."

Test with a throwaway account that has an FMP key on file (Part A needs real API calls to
fire) and, for Part B, a throwaway account whose admin-configured limits are low enough to
reach in a few clicks (2 pending templates / 5 approved / 6 portfolios are this repo's
current defaults — confirm via Admin Console → Config Properties if they've since changed).

## 1. Part A — Momentum real call tally
- [ ] As a user with an FMP key on file, run Momentum for any real symbol (e.g. AAPL).
- [ ] Confirm the analysis still renders correctly (score breakdown, no regression).
- [ ] Via direct DB query (`SELECT * FROM user_evt_usage WHERE user_id = '<id>' AND feature = 'momentum' ORDER BY created_at DESC LIMIT 1;`), confirm `api_call_details` is `{"fmp_historical": 1, "fmp_quote": 1}` — not a bare count.

## 2. Part A — Long-Term Analysis real call tally
- [ ] Run Long-Term Analysis for a symbol with real peers (e.g. AAPL, MSFT — expect FMP to return several peers, capped at 4).
- [ ] Confirm the analysis renders (including peer comparison table) with no regression.
- [ ] Query `user_evt_usage` for `feature = 'long_term_analysis'` → confirm `api_call_details.fmp` matches the formula `6 + 1 + peers.length*2 + 1 + 1` for however many peers the response actually returned (cross-check against the peer table's row count in the UI), and `finnhub` is `1` if a Finnhub key is on file, `0` otherwise.
- [ ] Run it again for a symbol with **zero** peers (or temporarily without a Finnhub key) → confirm the tally drops accordingly (lower `fmp`, `finnhub: 0`).

## 3. Part A — Contrarian Comeback real call tally
- [ ] Run a full Contrarian Comeback submission (not just the gate preview) for a symbol whose sector maps to a known ETF (e.g. Technology → XLK).
- [ ] Query `user_evt_usage` for `feature = 'contrarian_comeback'` → confirm `api_call_details.fmp = 10` (7 critical + 1 ETF historical + 2 fundamentals) and `finnhub` matches whether a Finnhub key is on file.
- [ ] Run it again for a symbol whose sector has **no** known ETF mapping → confirm `fmp = 9` (the ETF call didn't fire).
- [ ] Confirm `contrarian_comeback` gate-preview calls (`POST /contrarian-comeback/gate`) still do **not** appear in `user_evt_usage` at all — that endpoint was never logged and this didn't change.

## 4. Part B — quota indicator visibility (Create Portfolio)
- [ ] Go to Portfolio → Flex → "+ New Flex Portfolio". Confirm a "Flex portfolios: X/6" indicator is visible near the button **before** any action is taken (not just after an error).
- [ ] Proceed to the finalize step (either template path) — confirm the same indicator also appears next to Create Portfolio, with the same live current/limit numbers.
- [ ] Create a Flex portfolio successfully → confirm the indicator's "current" count increments immediately (no manual refresh needed).

## 5. Part B — quota indicator visibility (Save Template)
- [ ] Create (or select) a Flex-Err portfolio to reach the resolution banner. Confirm "Templates pending: X/2" and "Templates approved: X/5" indicators are both visible near Save Template, before submitting.
- [ ] Save a template successfully → confirm the "pending" count increments immediately.
- [ ] Have an admin approve that template (Admin Console → Portfolio Templates) → confirm, on a next visit to the resolution banner (or page reload), "approved" incremented and "pending" decremented accordingly.

## 6. Part B — pre-submission guard at the Flex-portfolio cap
- [ ] Drive a throwaway account to exactly 6 Flex portfolios (create them one at a time via the real UI, not the API).
- [ ] Confirm the "Flex portfolios: 6/6" indicator switches to a warning style ("limit reached — ask an admin to raise it") **before** attempting a 7th create.
- [ ] Confirm the Create Portfolio button is **disabled** at this point — the guard fires before any request is sent, not after a 409 comes back.
- [ ] Have an admin raise the limit (or delete one of the 6 portfolios) → confirm the indicator/button un-blocks without a page reload (refetch happens on the relevant success paths — a portfolio delete may need a manual revisit of the Flex tab, since quota status isn't invalidated by portfolio *deletion* today; note whether this is confirmed or a known gap).

## 7. Part B — pre-submission guard at the template caps
- [ ] Drive a throwaway account to 2 pending templates (don't get them approved) → confirm Save Template disables with the "pending" indicator in warning style on the next Flex-Err portfolio.
- [ ] Separately, drive a throwaway account to 5 approved templates (needs admin cooperation to approve each) → confirm Save Template disables with the "approved" indicator in warning style, even if pending count is still under its own cap (either cap alone should block).

## 8. Part B — 409 fallback still works (race-condition safety net)
- [ ] With two browser sessions on the same near-cap account, have session A create the final portfolio that reaches the cap right as session B's own indicator is still stale (hasn't refetched yet) and session B submits anyway.
- [ ] Confirm session B's submission still 409s cleanly, and the error renders as the new warning-styled callout (amber border/background), not a plain red line — same call-to-action text as the backend's own message, no duplicated text.
- [ ] Confirm a **non**-quota error (e.g. a duplicate template name) still renders in the original plain red/danger style, not the warning style — only 409s get the special treatment.

## 9. Cross-cutting
- [ ] Reload the Flex tab fresh (no cached quota data) → confirm the indicators appear shortly after load without requiring any user action (fetched on mount).
- [ ] Switch Legacy ↔ Flex sub-tabs and back → confirm the quota indicators don't flicker to a stale/blank state on return.
- [ ] Confirm none of the above introduced any regression to the existing Flex wizard flows (footer marker, cash row identifier, guided stepper) — a quick smoke pass through Section 3 of `portfolio-upload-flex-test-plan.md` is sufficient rather than a full re-run.

## Cleanup
- [ ] Delete all throwaway Flex portfolios/templates created above (both to reset quota state and to avoid leaving test data behind), and reset any admin-side limit overrides made to speed up reaching a cap.
