# Portfolio Upload — Flex: Manual Test Plan

Test with at least 3 accounts: a plain `user`, an `admin`, and (optionally) a second plain
`user` to verify cross-user approval visibility.

**Updated for the header row / data start column + how-to-use description feature** (added
after a real Charles Schwab CSV export exposed that the wizard assumed row 1/column 1 were
always the real header row/data start — see Section 4 below). Keep at least one real
Schwab-style export on hand (or fabricate one: 2–3 preamble/account-info lines above a real
header row) to exercise this properly — a simple single-header-row CSV won't touch the new
behavior at all since it's a no-op at the default `(1, 1)`.

## 1. RBAC / Tab visibility
- [ ] `user` role: Portfolio tab shows **only** the Legacy sub-tab (no Legacy/Flex toggle, no Flex content).
- [ ] `admin`/`admin-master`: Portfolio tab shows **both** Legacy and Flex sub-tabs with a toggle, defaulting to Legacy.
- [ ] A role granted only `portfolio_upload:flex` (no legacy): sees only the Flex sub-tab.
- [ ] A role granted neither permission: Portfolio tab still renders (read-only Legacy view — portfolio list visible, but **no** file-upload control).
- [ ] Admin Console shows a "Portfolio Templates" tab only for a session holding `portfolio_template:manage_status`.

## 2. Legacy sub-tab regression (should behave exactly as before)
- [ ] Create a new portfolio via Legacy, upload a real Fidelity/Empower/Robinhood-format file, confirm import works.
- [ ] "Proceed w/o Replace" import-preview flow still works.
- [ ] Refresh Prices still works.
- [ ] Any portfolio created via Flex does **not** appear in the Legacy sub-tab's portfolio selector.

## 3. Flex — create with a brand-new mapping, simple file (happy path)
Use a plain file whose real header row is row 1 (no preamble) — this is the baseline path
where the new header-row/data-start-column step is a no-op.
- [ ] "+ New Flex Portfolio" → "+ Create New Template" → choose a CSV/XLS file with a header row.
- [ ] Step "2. Confirm header row & data start column" appears, showing a raw preview grid. Both number inputs ("Header row" / "Data start column") default to **1**, and row 1 is highlighted in the grid.
- [ ] Without touching the grid or the number inputs, step "3. Map columns" already shows the file's real headers in every dropdown (defaults are correct for a simple file).
- [ ] "Inspect Data" stays disabled until Symbol, Quantity, and Current Price are all mapped.
- [ ] Map all fields (including some optional ones like Name/Sector) → Inspect Data → verify the top-5 preview looks correct.
- [ ] "Use This Mapping" → enter a portfolio name → Create Portfolio.
- [ ] Confirm a **real** Dashboard renders (correct Total Value, Holdings table, Allocation/Performance charts).
- [ ] Confirm the portfolio's pill shows a ⚠ marker, and the "This portfolio needs attention" banner appears.

## 4. Flex — header row / data start column selection (Schwab-style file)
Use a file with genuine preamble rows above the real header (e.g. Schwab's "Positions for
account…"/"As of…" lines), and ideally a leading label column too.
- [ ] Upload the file → at the default `(1, 1)` selection, step "3. Map columns" dropdowns show the **wrong** values (the preamble text, not real column headers) — confirms the bug this feature fixes would otherwise still be present.
- [ ] In the grid preview, click the cell that is the real first header cell (e.g. "Symbol"/"Ticker"). Confirm **both** the "Header row" and "Data start column" number inputs update to match that cell's row/column in one click.
- [ ] Confirm the grid visually marks the selected header row (e.g. highlighted row) and dims cells above/left of the selection (the skipped preamble rows/leading column).
- [ ] Confirm step "3. Map columns" dropdowns now show the file's real headers.
- [ ] Reset the file (re-upload the same file) and this time use the **number inputs** directly instead of clicking — type the correct header row and data start column numbers. Confirm this produces the identical result to clicking the cell (same headers available to map).
- [ ] With the correct row/column selected, map Symbol/Quantity/Current Price → Inspect Data → confirm the preview is correct (not garbage).
- [ ] Now, **after** mapping fields, change the "Header row" or "Data start column" number again. Confirm the in-progress field mapping is cleared (forces re-mapping against the new header set — a stale mapping could otherwise silently point at the wrong column).
- [ ] Use This Mapping → Create Portfolio → confirm the Dashboard renders correctly (proves the offset was actually applied end-to-end, not just cosmetically in the wizard).

### 4a. Blank-line-before-header regression (real bug found 2026-08-26, now fixed)
Use a file with a genuinely **blank line** somewhere above the real header row (e.g. a blank
separator between an account-info preamble line and the header row — very common in real
Schwab-style exports).
- [ ] Set "Header row" to the real header's row number (counting every line, blank included, the same way the grid displays them).
- [ ] Confirm step "3. Map columns" dropdowns show the file's **real headers**, not another row's data (this is exactly the bug: a blank line before the header used to make the backend read the wrong row entirely once "Inspect Data" ran, even though the wizard's own grid looked correct).
- [ ] Map fields → Inspect Data → confirm the preview shows real holdings, not a "headers don't match the mapping" error listing actual data values.
- [ ] Use This Mapping → Create Portfolio → confirm the Dashboard renders correctly.

### 4b. Footer marker — click-to-set and manual text entry
Use a file with footer content below the real holdings (a totals row, a disclaimer line, or both).
- [ ] Click "Set footer marker" (next to "Set header row / data start"), then click the cell that marks where the footer begins (e.g. a cell containing "Total" or "Position Total"). Confirm the footer marker text field pre-fills with that cell's text, and the column number shown next to it matches the clicked column.
- [ ] Edit the pre-filled text (e.g. narrow "Position Total" down to just "Total") and confirm it's editable.
- [ ] Clear the file and re-upload it; this time type the footer marker text directly into the field without clicking a cell — pick a column number that also makes sense. Confirm this works without ever clicking the grid.
- [ ] Map Symbol/Quantity/Current Price → Inspect Data → confirm the preview **excludes** the footer row and anything below it, showing only real holdings.
- [ ] Use This Mapping → Create Portfolio → confirm the Dashboard's totals reflect only the real holdings (not inflated by a totals/footer row that slipped through).
- [ ] Save Template, then reuse it (Section 8) against a **second, larger file** of the same shape (well over 200 rows, more holdings than the original sample) — confirm the footer is still correctly excluded and the upload succeeds, proving reuse has no row-count restriction (only defining a new template does).

### 4c. Footer marker — no match, and the 202-row hard limit
- [ ] Set a footer marker whose text never appears anywhere in the file → Inspect Data → confirm the file still parses successfully to its real end (no error) — a footer marker not matching isn't treated as a failure.
- [ ] Try selecting a sample file with **more than 202 rows** for a brand-new template (Section 3 or here) → confirm the wizard rejects it immediately with a clear message before showing the grid/mapping step at all, and that this only applies to defining a **new** mapping — never to reusing an already-saved template.

## 5. Flex — Save Template, including the how-to-use description
- [ ] On the banner, enter a template name and (optionally) fill in "How to use this template" (e.g. "Schwab export — headers on row 3, account column on the left") → Save Template.
- [ ] Banner disappears, ⚠ marker clears.
- [ ] Leave the how-to-use field blank on a different template → confirm Save Template still succeeds (it's optional).
- [ ] Create another new Flex portfolio → confirm the just-saved template(s) appear under "Your Pending Approval Templates."
- [ ] Try saving with a name that's too short or has no letters — confirm a clear validation error.
- [ ] Try saving with a name that duplicates an existing template — confirm a clear conflict error.

## 6. Flex — Delete Portfolio (bad mapping)
- [ ] Create a Flex portfolio with an intentionally wrong mapping (e.g., swap Quantity ↔ Current Price) so the Dashboard looks nonsensical.
- [ ] From the banner, click Delete Portfolio → confirm → portfolio disappears from the list, no leftover template row.

## 7. Flex — resolving a portfolio you didn't just create (session-lost case)
- [ ] Create a Flex-Err portfolio, then **reload the page** (simulating leaving mid-decision) before saving/deleting.
- [ ] Confirm the banner still shows "needs attention," but now requires re-running the mapping wizard (re-upload the file, re-confirm header row/data start column, re-map) before Save Template is available.

## 8. Flex — reuse an existing/pending template (the actual point of this feature)
Reuse the Schwab-style template saved in Section 4/5, with a **new** file of the same shape
(same preamble structure, real data changed).
- [ ] "+ New Flex Portfolio" → pick the earlier-saved template from the "Existing Template" search list or "Pending Approval" dropdown.
- [ ] Hover over the template's name in the list — confirm the "How to use" text you entered in Section 5 appears as a tooltip.
- [ ] Confirm the mapping wizard (including the grid step) is skipped entirely — just name + file.
- [ ] Confirm the new portfolio resolves immediately (no ⚠, no banner) **and** the Dashboard renders correct holdings — proving the template's saved header row/data start column were applied automatically, without the user ever re-specifying them.
- [ ] For comparison, also reuse a template saved with defaults `(1, 1)` (from Section 3) against a same-shaped simple file — confirm that still works identically to before this feature existed.

## 9. Flex — change/re-upload on an already-resolved portfolio
- [ ] On a resolved Flex portfolio, upload a new file (reuses the current template, including its header row/data start column) — confirm holdings update correctly.
- [ ] Use "Change Template" with a different mapping (run through the grid step again if the new file has a different layout) — confirm it requires re-inspecting before rebinding, and updates correctly.

## 10. Flex — error/edge cases
- [ ] Upload a file missing a mandatory column while reusing a template — confirm a clear "mapping doesn't match this file" error, not a crash.
- [ ] Upload an empty/garbage CSV — confirm a clean error message.
- [ ] Try an .xlsx file through the Flex wizard, including one with preamble rows — confirm it converts, the grid step shows the converted rows correctly, and parses correctly once the header row/data start column are selected.
- [ ] In the grid step, try typing a header row number larger than the file's row count, or a data start column beyond the header row's width — confirm the input clamps to a valid value rather than erroring.

## 11. Admin Console — Portfolio Templates
- [ ] Log in as admin → Admin → Portfolio Templates tab lists all templates regardless of status.
- [ ] Click a Pending template's name → confirm the "How to use" description (if one was entered), the "Header row X, data starts at column Y" line, the column mapping, and the sample preview all display correctly.
- [ ] Click a Pending template that was saved **without** a how-to-use description → confirm the "How to use" section simply doesn't render (no blank/empty heading).
- [ ] Approve it → status flips, Approve/Reject buttons disappear.
- [ ] Log in as a **different** plain user with `portfolio_upload:flex` → confirm the now-Approved template appears in their "Existing Template" search list, with its how-to-use tooltip intact.
- [ ] Reject a different Pending template → confirm it's no longer offered to any user for new uploads.

## 12. Cross-cutting
- [ ] Switch Legacy ↔ Flex sub-tabs and back — confirm in-progress state (e.g., a half-filled wizard, including a grid selection already made) is preserved, not reset.
- [ ] Switch to another top-level tab (e.g., Momentum) and back to Portfolio — confirm selected sub-tab/portfolio is preserved.
- [ ] Resize to mobile width — Holdings table still switches to card view on a Flex portfolio's Dashboard, and the grid preview in the wizard stays usable (scrollable) rather than breaking layout.
