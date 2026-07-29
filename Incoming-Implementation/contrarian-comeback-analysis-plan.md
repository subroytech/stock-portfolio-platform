# Contrarian Comeback Analysis (Architecture.md Section 3, Item 3) — Scoped Plan

**Status:** Scoped via `/plan` on 2026-07-27. Not yet started — deferred while Contrarian
Finder gap fixes are done first. Preserved here so the scoping work isn't lost.

## Context

Next backlog item after Long-Term Analysis (item 2, done). The source app's
`contrarian-analysis.html` is reported as 500+ lines of real logic with zero backend
equivalent today — meaningfully bigger than Long-Term Analysis (~150 lines). Per explicit
user decision, **this item will be built in sequential phases, each fully
built/tested/verified before the next starts** — not one big-bang implementation.

**Methodology, resolved same way as Long-Term Analysis**: this repo also has a
`contrarian-comeback-analyzer` Claude skill. Unlike the Long-Term Analysis situation, the
skill and the HTML page are **methodologically aligned** (same 5-factor/10-point rubric,
identical threshold numbers, identical Check-3 override reason codes). They diverge only in
*execution*: the skill performs every step — including checks the HTML computes
deterministically from FMP numbers — via live `Search:`/`Fetch:` web tool calls, making it
not deployable as a stateless Python endpoint. **Decision: port the HTML's deterministic
FMP-driven model; the skill is untouched, used only as a threshold/spec cross-reference.**

**Confirmed decisions:**
1. **Phased execution** (explicit ask) — Phase 1 (gate + score + verdict, the
   decision-relevant core) must be fully built, tested, and manually verified live before
   Phase 2 (fundamental health + catalyst pipeline) starts; Phase 2 fully cleared before
   Phase 3 (staged entry + recovery scenarios + invalidation checklist).
2. **Checks 2 & 5 are real form inputs.** These two of the gate's 5 checks are pure human
   judgment in the source app (breakdown-type classification, "is there a genuine
   catalyst?" checkboxes) — not computable from FMP data. The frontend page presents them
   as actual form controls; Node passes the user's answers through to Python alongside the
   FMP-sourced data. Most faithful port of the source app's actual UX.
3. **No custom charts in V1.** Skip the weekly price+SMA200W+Fibonacci chart and the
   sector-health chart for now (real new charting work — Fibonacci overlays don't exist
   off-the-shelf in `react-chartjs-2`). Reuse the existing `StockPreviewChart` component for
   a basic price view, same as Long-Term Analysis did. Revisit as a later enhancement, not
   assigned a phase number yet.

---

## Algorithm reference (ported from `../CreateStockPortfolioViewWOSkill/contrarian-analysis.html`,
881 lines; verified via a research agent — re-verify exact thresholds against the file
directly before implementing, the same way `lt-analysis.html` was re-read verbatim before
the Long-Term Analysis port)

### Gate — 5 checks
- **Check 1 (auto)**: `drawdownPct = max(dd52w, dd4y) ≥ 25%`, else Format B (no opportunity).
- **Check 2 (user form input)**: breakdown-type classification. Any 🔴 type (structural/
  valuation/fraud) → Format B. 🟡-only → "hybrid cap" (final score capped at 7/10).
- **Check 3 (auto)**: mapped sector ETF's 6-month return. `< -20%` → hard block, no
  override. `< -5%` → override available (reason keys `macro`/`etf_drag`/`decoupled`/
  `own_research`, matching the skill's SKILL.md verbatim) but caps final score at 6/10.
  `≥ -5%` → passes clean.
- **Check 4 (auto)**: `mostRecentAnnualIncomeStatement.revenue > 0`, else Format B.
- **Check 5 (user form input)**: "is there a genuine catalyst?" yes/no. No → Format B.

### Weekly technicals (built from scratch, no FMP weekly-bar endpoint)
- `toWeeklyBars()`: bucket ~1000 daily bars (≈4yr) into Mon-start weeks (open=first,
  high/low=max/min, close=last, volume=summed).
- **Weekly RSI(14)**: Wilder's smoothing — same formula already implemented in
  `backend/src/services/momentum.service.ts`'s `mwRSI` (daily version), just fed weekly
  closes instead of daily. Reusable as a cross-check reference during Python porting, even
  though the new code is Python not TS.
- **OBV trend**: cumulative OBV over weekly bars; compare avg(weeks[n-8:n-4]) vs.
  avg(weeks[n-4:n]) → up if latter > 1.02×former, down if < 0.98×former, else flat.
  **Volume-drying**: avg(last 4wk volume) < 0.85 × avg(prior 4wk volume).
- **Fibonacci**: `swingLow` = min low over trailing 252 daily bars (fallback `price*0.80`);
  `athPrice` = max high over ~1000-bar (4yr) history; retracement/extension levels =
  `swingLow + (ath - swingLow) * {0.382, 0.618, 1.0}`.

### 5-factor score (0-2 each, /10 total)
```
breakdown = dd>40 && isEventDriven ? 2 : dd>=25 ? 1 : 0
sector    = etf6m>5 ? 2 : etf6m>=-2 ? 1 : 0        (forced 0 if Check-3 override active)
technical = (rsi<35 && volDrying && obvUp) ? 2 : rsi<40 ? 1 : 0
value     = (pe>60 || ps>25) ? 0 : upside>40 ? 2 : upside>25 ? 1 : 0
catalyst  = (insiderBuying || strongCatalyst) ? 2 : anyAnalystUpgrades ? 1 : 0

verdict = score>=8 ? 'HIGH' : score>=6 ? 'MODERATE' : score>=4 ? 'SPECULATIVE' : 'AVOID'
// hybrid-breakdown cap (7) and sector-override cap (6) apply — lower cap wins if both active
```

### FMP endpoints needed (confirm exact field names/shapes live, per the Long-Term Analysis
lesson that `/stable` responses often differ from what the source app or docs assume)
`/profile`, `/quote`, `/income-statement` (annual, limit 4), `/balance-sheet-statement`
(annual, limit 2 — Phase 2), `/cash-flow-statement` (annual, limit 2 — Phase 2),
`/price-target-consensus`, `/grades` (limit 50), `/insider-trading` (v4, limit 20 — check
this is still the right base/path), `/historical-price-eod/full` (limit 1000) for the stock
**and again** (limit 260) for the FMP-mapped sector ETF. Optional Finnhub `/company-news`
for display-only news (Phase 2 catalyst pipeline), not gate/score logic.

### Relationship to existing code
Confirmed distinct from `contrarianFinder.service.ts` (the Contrarian Finder *scanner* —
backlog item 5, screens ~450 stocks for ≥25% 5-day decliners). This feature is the
*single-ticker deep-dive* a user opens from that shortlist. No code overlap beyond the RSI
formula shape.

---

## Phase 1 — Gate + 5-Factor Score + Verdict (build this first, fully test before Phase 2)

**Python** (`analysis-service/`, new `app/models/contrarian_comeback.py` +
`app/scoring/contrarian_comeback.py`, following `long_term.py`'s exact pattern): weekly-bar
aggregation, weekly RSI/OBV/volume-drying, Fibonacci levels, the 5-factor score, gate
evaluation (checks 1/3/4 computed from payload data; checks 2/5 taken as request fields
since they're user-supplied), Format-A (full result) vs. Format-B (rejection + reason)
response shape. New `POST /contrarian-comeback` endpoint in `main.py`. Pytest coverage
mirroring Long-Term Analysis's boundary-testing discipline — every gate threshold, every
score-factor boundary, both cap rules (hybrid=7, override=6, lower wins), Format-A vs.
Format-B branching.

**Node** (`backend/src/services/contrarianComebackData.service.ts`, new): fetches
profile/quote/income-statement/price-target/grades/insider-trading/historical-price-eod
(stock + sector ETF) via `fmpGet`, same per-user-key + critical/non-critical split as
`longTermAnalysisData.service.ts`. `analysisService.ts` gains `computeContrarianComeback()`.
New controller handler + route — likely `POST /analysis/contrarian-comeback/:symbol` (not
GET, since checks 2/5 need a request body for the user's form answers — first
on-demand-analysis endpoint in this repo needing a body, flag this as worth confirming
against convention before implementing, similar to how Long-Term Analysis's GET-vs-POST
call was resolved by precedent — here precedent points toward POST given the mandatory
body).

**Frontend**: new `ContrarianComebackPage.tsx` — ticker input, then the two required
form controls (breakdown-type checkboxes, catalyst yes/no) *before* submission is allowed,
then gate result / score breakdown / verdict display. New `api/contrarianComeback.ts`
mirroring the Python response model. Route + nav link, following the exact
`LongTermAnalysisPage`/`useLongTermAnalysis` pattern.

**Phase 1 test gate (must pass before Phase 2 starts)**: pytest/jest/vitest all green,
`tsc`/lint clean on all three, and a manual live validation run against a real FMP account
(same discipline as Long-Term Analysis's session — expect real endpoint-shape surprises;
budget time for it) confirming gate/score/verdict produce sane results for a known
historical comeback-candidate ticker.

## Phase 2 — Fundamental Health + Catalyst Pipeline (only after Phase 1 is clear)

Add balance-sheet/cash-flow-statement fetches; compute D/E, current ratio, FCF, revenue
growth, gross margin, cash runway (all with the source app's numeric green/yellow/red
thresholds — re-verify exact cutoffs against `contrarian-analysis.html` when this phase
starts). Add the catalyst pipeline (news/insider/analyst tables — optional Finnhub news,
same soft-fail-to-empty pattern as Long-Term Analysis). Extend the Python
models/scoring, Node data-fetch, and frontend page additively — same files as Phase 1,
not new ones. Same full test-gate discipline before Phase 3.

## Phase 3 — Staged Entry + Recovery Scenarios + Invalidation Checklist (only after Phase 2 is clear)

3-tranche staged entry (40/35/25%, hard stop -15% from tranche 1), 3-scenario recovery
targets with R:R (uses Fibonacci levels already computed in Phase 1 — no new FMP calls
needed), 6-item invalidation checklist. Pure computation on data already being fetched;
smallest phase of the three. Same full test-gate discipline before considering the feature
done.

## Deferred, not phase-numbered yet
Weekly price+SMA200W+Fibonacci chart and sector-health chart — real new frontend charting
work, explicitly out of scope per this session's decision. Revisit as a future enhancement
once Phases 1-3 are done and the feature's core value is proven.

---

## Verification (per phase)
1. `poetry run pytest` in `analysis-service/` — new tests for that phase's scoring/models.
2. `npm test` + `npx tsc --noEmit` + lint in `backend/`.
3. `npm test` + `npx tsc --noEmit` + lint in `frontend/`.
4. Manual live check against a real FMP account (start `analysis-service` + `backend`,
   sign in a test user, add/reuse an FMP key, call the endpoint directly) — confirm no
   silent nulls/wrong-endpoint bugs the way Long-Term Analysis's validation caught 3 real
   ones. Clean up any throwaway test user afterward.
5. Only move to the next phase once all of the above are green for the current one.
