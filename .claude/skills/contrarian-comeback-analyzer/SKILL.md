---
name: contrarian-comeback-analyzer
description: >
  Contrarian reversal analysis for US equities (NYSE/NASDAQ) — Large-Cap and Mid-Cap.
  Use this skill whenever the user wants to analyze a TEMPORARILY BROKEN stock in a
  HAPPENING SECTOR for a 12–24 month comeback thesis. Trigger on phrases like:
  "contrarian play on [TICKER]", "is [TICKER] a comeback candidate", "temporarily
  broken stock", "fallen angel in [SECTOR]", "[TICKER] has crashed should I buy",
  "beaten down in a strong sector", "deep value reversal", "contrarian thesis for
  [TICKER]", "is [TICKER] a buying opportunity after the crash", "[TICKER] turnaround
  story", "broken but not dead", "event-driven breakdown in [TICKER]", "stock fell on
  a failed deal", "acquisition drama hit [TICKER]", "is this a buying opportunity",
  "stock is down heavily is it worth it", "[TICKER] fell despite good earnings", "what
  happened to [TICKER] stock", "should I buy the dip on [TICKER]". CRITICAL: This
  skill runs a five-check HARD GATE before any analysis. It will REFUSE to force-fit
  a contrarian thesis where none genuinely exists and will output a clear NO OPPORTUNITY
  verdict with the precise reason. An honest rejection is more valuable than a false
  thesis. Never skip when a user asks about any stock that has fallen significantly.
---

# Contrarian Comeback Analyzer

Contrarian reversal analysis for US equities — **Large-Cap and Mid-Cap**. Holding period: **12–24 months**.
Built for the strategy: *"Temporarily broken company in a happening sector."*

---

## ⛔ CARDINAL RULE — READ BEFORE ANYTHING ELSE

> **NEVER force-fit a contrarian thesis where one does not genuinely exist.**
>
> This skill's entire value depends on intellectual honesty. If a stock's breakdown
> is STRUCTURAL — not temporary — saying so clearly IS the analysis. A false
> contrarian call is more dangerous than no call at all.
>
> If the HARD GATE (Step 0) is not passed in full, **STOP immediately**.
> Do not produce a softened or partial analysis. Do not say "it could go either way."
> Output the NO OPPORTUNITY verdict (Format B) and explain precisely why.
> The user is better served by clear truth than a thesis that does not hold up.

---

## Core Philosophy

The contrarian comeback strategy rests on a precise four-part thesis:

1. A high-quality company in a **structurally healthy sector** suffers a sharp,
   event-driven breakdown — not a structural one.
2. Market sentiment overreacts, driving the stock well below intrinsic value.
3. The underlying business remains intact. The sector tailwind is still blowing.
4. With patience (12–24 months), mean reversion + sector momentum = recovery.

The edge is NOT in finding cheap stocks. It is in correctly distinguishing
**temporary pain from permanent impairment**.

---

## Input

- **Required:** Stock ticker symbol (e.g. UNH, NFLX, BKNG)
- **Optional:** Context on why the stock has fallen (accelerates classification)
- **Optional:** Sector or comparable company context

If only a company name is provided, resolve the ticker before proceeding.

---

## Analysis Pipeline

---

### ━━━ PHASE 1 — PRE-ENTRY ANALYSIS ━━━
*Should I even consider this stock?*

---

### ⛔ STEP 0 — HARD GATE: Contrarian Opportunity Screen

**This step fires FIRST. ALL five checks must pass. If ANY check fails → STOP.**
**Output Format B immediately. Do not proceed to Step 1.**

```
[ ] CHECK 1 — DRAWDOWN SEVERITY
    Search: {TICKER} 52-week high all-time high current price {year}
    PASS: Stock is ≥ 25% below its recent 52-week or all-time high
    FAIL: Drawdown < 25% → no meaningful dislocation, NO CONTRARIAN SETUP

[ ] CHECK 2 — PRELIMINARY BREAKDOWN TYPE
    Search: {TICKER} why did stock crash fall reason news 2024 2025 2026

    PASS — event-driven triggers (these belong in this skill):
      • Leadership crisis: CEO death, sudden resignation, scandal
      • Regulatory event: probe, investigation, fine (not yet criminal)
      • One-time impairment: cyberattack, supply-chain shock, one-off miss
      • PR / sentiment overreaction: public backlash, short-seller attack
      • Failed corporate action: blocked M&A bid, withdrawn acquisition,
        deal termination (stock penalised for what management tried, not
        what the business IS)  ← NFLX 2025–26 is the canonical example

    FAIL — these do NOT belong in this skill:
      • Structural: business model disrupted, moat eroding, secular decline
      • Fraud / governance: accounting irregularities, criminal leadership
      • Valuation normalization: stock correcting from extreme overvaluation
        (e.g., P/S > 30× or P/E > 100× at peak) WITHOUT a specific crisis
        event impairing the business. KEY TEST — if the business is actually
        ACCELERATING (earnings beats, guidance raises) while the stock falls,
        the decline is multiple compression, NOT a contrarian opportunity.
        ← PLTR 2025–26 is the canonical example of this FAIL pattern.

[ ] CHECK 3 — SECTOR HEALTH
    Search: {SECTOR ETF} performance trend 2025 2026
    PASS: The relevant sector ETF is neutral or in uptrend over 6–12 months
    FAIL: Sector ETF in sustained downtrend → SECTOR HEADWIND DISQUALIFIES

    ⚠️ OVERRIDE AVAILABLE (Check 3 only):
    If Check 3 is the SOLE failing check, the user may elect to override it
    and continue analysis under a degraded path. This override exists because
    sector ETFs can be temporarily depressed (macro shock, rate scare, rotation)
    while an individual stock's breakdown is still company-specific and recoverable.
    The override is NOT a free pass — it changes the scoring ceiling and output
    label. See "Check 3 Override Protocol" immediately below the gate table.

    HARD BLOCK — override NOT available if:
    • Sector ETF is down > 20% over the past 6 months (severe structural headwind —
      the tailwind this strategy requires is absent; no override can compensate)
    • More than one gate check is failing (Check 3 override does not cover other fails)

    Note: ETF position vs 12M moving average and volume trend are shown as
    informational context in the Gate UI to help the user evaluate their override
    rationale — they do NOT independently trigger a Hard Block.

[ ] CHECK 4 — COMPANY VIABILITY
    Search: {TICKER} revenue earnings going concern debt credit rating
    PASS: Company generating positive revenues; no bankruptcy or going-concern risk
    FAIL: Existential business risk present → NOT A CONTRARIAN PLAY

[ ] CHECK 5 — RECOVERY CATALYST EXISTS
    Search: {TICKER} recovery catalyst outlook 2025 2026 turnaround
    PASS: At least one identifiable catalyst (earnings reset, leadership
          resolution, regulatory clarity, overhang removed, repricing cycle)
    FAIL: No visible path to recovery narrative → INSUFFICIENT BASIS
```

**If ALL 5 pass → Proceed to Step 1.**
**If ANY fail → Output Format B (NO OPPORTUNITY). Full stop.**
**Exception: Check 3 may be overridden — see protocol below.**

---

### ⚠️ Check 3 Override Protocol

*This protocol activates only when: (a) the user explicitly elects to override, and (b) the Hard Block conditions above are NOT met.*

**Step O-1 — Present the evidence before the user decides:**
Display the following before asking for the override decision:
```
SECTOR CHECK DETAIL — {SECTOR ETF}
  6-month ETF return:     -X.X%  (threshold: > -20% required to override)
  ETF vs 12M moving avg:  [Above / Below]
  ETF volume trend:       [Declining / Flat / Rising]
  Auto-result:            ❌ FAIL — Sector headwind detected

  To override: Explain why the sector headwind is temporary or
  does not apply to this stock's specific recovery thesis.
```

**Step O-2 — Require a stated override rationale:**
The user must select or state ONE of the following reasons:
- **Macro-driven dip** — sector ETF down due to rate/macro shock, not sector fundamentals
- **ETF composition drag** — one or two large ETF components pulling the index; peers intact
- **Company decoupled** — stock's breakdown cause is entirely independent of sector direction
- **Own research** — user has sector research that contradicts the ETF signal (specify)

**Step O-3 — Apply degraded analysis rules (non-negotiable):**

| Rule | Normal Path | Override Path |
|------|-------------|---------------|
| Sector Health component score | Up to 2/2 | Forced to **0/2** |
| Total score ceiling | 10/10 | Capped at **6/10** (MODERATE max) |
| Opportunity verdict ceiling | HIGH CONVICTION possible | **MODERATE CONVICTION** maximum |
| Output label | None | Orange banner: **"⚠️ SECTOR OVERRIDE ACTIVE"** |
| Format | Format A | Format A + override warning block |

**Step O-4 — Add override block to output:**
Insert this immediately after the SECTOR HEALTH section in Format A:
```
⚠️ SECTOR OVERRIDE ACTIVE
──────────────────────────────────────────────────────────────
Override reason:    [User-stated rationale]
ETF 6M return:      -X.X%  (below pass threshold; override elected)
Risk implication:   Score ceiling is 6/10. If sector headwind persists
                    or worsens, thesis may not recover on the expected
                    12–24 month timeline. Monitor ETF trend monthly.
Invalidation note:  Add to Post-Entry Monitoring — if sector ETF drops
                    a further 10% from today OR breaks below 200-week
                    SMA → override rationale no longer holds; exit plan.
──────────────────────────────────────────────────────────────
```

---

### Step 1 — Breakdown Classification

```
Search: {TICKER} breakdown reason crash catalyst 2024 2025 2026
Search: {TICKER} fundamentals revenue earnings trend multi-year history
```

Classify the breakdown using this table:

| Type | Description | Verdict |
|------|-------------|---------|
| 🟢 Event-Driven | CEO crisis, scandal, probe, cyberattack, PR shock, one-off miss | PROCEED — likely temporary |
| 🟢 Failed Corporate Action | Blocked M&A, withdrawn acquisition, deal termination creating overhang | PROCEED — overhang, not impairment |
| 🟡 Cyclical | Industry downturn hitting all sector peers similarly | CAUTION — sector check critical |
| 🟠 Guidance Reset | Company cut guidance but business model intact | PROCEED with lower conviction |
| 🔴 Structural | Business model threatened, moat eroding, secular decline | STOP — not a contrarian play |
| 🔴 Valuation Reset | Stock correcting from extreme overvaluation; business actually healthy | STOP — wrong tool; use LT-MT Analyzer |
| 🔴 Fraud/Governance | Accounting irregularities, criminal leadership, regulatory seizure | STOP — avoid entirely |

**Key distinction test:** Are peers in the same sector performing well while THIS
stock is broken? If yes → company-specific dislocation. If peers are also down →
cyclical or structural issue. If the business is BEATING estimates while stock falls
→ likely valuation reset, not contrarian opportunity.

---

### Step 2 — Sector Health Check

```
Search: {SECTOR ETF} price trend performance 2025 2026
Search: {SECTOR} industry structural tailwinds long-term outlook
Search: {TICKER} vs {SECTOR ETF} relative performance 12 months
```

Identify the relevant sector ETF (e.g., XLV Healthcare, XLK Tech, XLE Energy,
XLF Financials, XBI Biotech, XLC Communication Services).

Evaluate four dimensions:
- Is the sector ETF above its 12-month average? (Bullish backdrop)
- Is the sector ETF in an uptrend over the last 6 months? (Momentum intact)
- Are sector peers performing well while this stock is broken? (Confirms event-driven)
- What are the 3-year structural tailwinds for this sector?

**Sector-Stock Spread:** How much has this stock underperformed the sector ETF over
12 months? A spread of >30% in a healthy sector is the contrarian fuel — the stock
is broken while the sector is not.

---

### Step 3 — Value Trap Warning Signs

Before proceeding further, check the company against these seven structural red flags.
These are distinct from the HARD GATE: the gate filters *event type*; this step
filters *business structure*. A stock can pass all five gate checks and still be a
value trap if the underlying business is quietly deteriorating.

```
Search: {TICKER} guidance history missed estimates consecutive quarters
Search: {TICKER} competitive position market share disruption threat
Search: {TICKER} debt buyback history insider selling transactions
```

| # | Warning Sign | Detail |
|---|---|---|
| 1 | **Serial guidance-cutter** | Management has missed guidance 3+ consecutive quarters — credibility destroyed |
| 2 | **Shrinking addressable market** | Industry itself in secular decline (physical media, legacy hardware, print, etc.) |
| 3 | **Disruption underway** | A clear technological or competitive disruptor is actively taking share right now |
| 4 | **Debt-funded buybacks** | Company borrowed heavily to repurchase stock at peak prices; balance sheet now impaired |
| 5 | **Accounting complexity** | Revenue recognition changes, frequent one-time items, or auditor notes or qualifications |
| 6 | **Founder/CEO departure** | Key-person risk — especially if abrupt, acrimonious, or without clear succession plan |
| 7 | **Customer concentration** | Top 1–2 customers > 30% of revenue; any sign of churn is existential |

> **Rule:** If **2 or more** of these are present → classify as **Value Trap**.
> Do not proceed to scoring regardless of how cheap the valuation appears.
> "Cheap can always get cheaper" when the business is structurally compromised.

If 0–1 flags are present, note any that apply and carry them into the Key Risks
section of the output.

---

### Step 4 — Fundamental Health Check

Verify the business is financially intact despite the price decline. This step is a
**confirmation layer for large-cap names** and a **near-gate for mid-cap names** —
at smaller market caps, balance sheet stress can deteriorate rapidly and recovery
windows are shorter.

```
Search: {TICKER} balance sheet debt cash current ratio {current_year}
Search: {TICKER} free cash flow revenue trend gross margin {current_year}
Fetch:  https://finance.yahoo.com/quote/{TICKER}/financials
```

**Key metrics:**

| Metric | Green Flag | Red Flag |
|---|---|---|
| Debt-to-Equity | < 1.5× | > 3× or rising fast |
| Current Ratio | > 1.2 | < 0.8 |
| Free Cash Flow | Positive and stable | Negative and deteriorating |
| Revenue trend | Stable or growing | Accelerating decline |
| Gross Margin | Stable or expanding | Compressing quarter-over-quarter |
| Cash runway | > 18 months | < 9 months (if unprofitable) |

**Large-Cap vs Mid-Cap calibration:**
- **Large-Cap (> $10B market cap):** One red flag = caution note in output. Two or more
  red flags = disqualifier. Cash runway is rarely the primary concern but verify
  regardless. Debt-to-Equity thresholds hold; structured institutional debt differs
  from distress-driven leverage.
- **Mid-Cap ($2B–$10B):** Treat each red flag with higher urgency — mid-cap deterioration
  accelerates faster and lenders have less patience. Cash runway and FCF trajectory
  are especially critical. Two red flags here is a hard disqualifier; even one
  demands a clear explanation before proceeding.

**Automatic disqualifiers** — stop analysis if any of the following are present,
regardless of market cap:
- Debt covenant violations or active risk of default
- Revenue decline accelerating for 3+ consecutive quarters
- Auditor concerns, going-concern notes, or financial restatements
- Insider selling at elevated pace *after* the stock has already declined significantly

---

### Step 5 — Long-Term Technical Analysis

```
Search: {TICKER} stock price 52-week chart weekly support levels {year}
Fetch:  https://finance.yahoo.com/quote/{TICKER}/history/
Search: {TICKER} 200 week moving average support 2025 2026
```

**⚠️ Stock Split Check:** Before plotting any levels, confirm whether the company
executed a stock split in the last 12–18 months. Always use split-adjusted prices
throughout. A 10:1 split creates an optical 90% drop on unadjusted charts that is
NOT a real breakdown. (NFLX executed a 10:1 split November 17, 2025 — a common
pitfall.) Adjust all Fibonacci and support levels to split-adjusted data.

Use **WEEKLY and MONTHLY charts** — not daily. This is a 12–24 month thesis.

**A. Breakdown Zone**
— Where was the prior trading range before the crash? (Now resistance)
— What key support level broke and became resistance?

**B. Current Support Levels (Weekly)**
— Most recent significant swing low on the weekly chart
— 200-week SMA — the long-term institutional support line
— Fibonacci retracement levels from ATH to the capitulation low

**C. Volume & Exhaustion Signals**
— Is selling volume declining over the past 4–8 weeks? (Sellers tiring)
— Was there a high-volume capitulation day? (Emotional selling peak = potential low)
— On-Balance Volume (OBV) trend — is quiet accumulation beginning?

**D. Bottoming Patterns (Weekly Chart)**
— Rounded bottom beginning to form?
— Higher lows developing after the capitulation low?
— Price beginning to reclaim the 20-week SMA?

**E. Weekly RSI Levels**
— RSI 28–38: Deep oversold. Primary contrarian entry zone.
— RSI 38–50: Recovering from oversold. Watch for crossover confirmation.
— RSI > 50: Early recovery phase. Tranche 3 territory.

**Fibonacci Recovery Targets (calculate from ATH to capitulation low):**
- Conservative: 38.2% retracement level
- Base Case:    61.8% retracement level
- Bull Case:    100% retracement (full recovery to ATH)

---

### Step 6 — Contrarian Score (1–10)

Score the opportunity across five components:

| Component | Max | Criteria |
|-----------|-----|----------|
| Breakdown severity & type | 2 | 1pt: 25–40% off highs OR event-driven; 2pts: >40% off highs AND confirmed event-driven or failed corporate action |
| Sector health | 2 | 1pt: sector neutral; 2pts: sector in clear uptrend with 3Y+ structural tailwind |
| Technical exhaustion | 2 | 1pt: weekly RSI < 40; 2pts: RSI < 35 + volume drying up + OBV turning |
| Value dislocation | 2 | 1pt: P/E or P/B below 5-year average OR analyst consensus >25% upside; 2pts: DCF or analyst consensus >40% upside AND P/E at low end of historical range |
| Catalyst pipeline | 2 | 1pt: one catalyst identified; 2pts: multiple catalysts OR a major overhang recently resolved |

**⚠️ Valuation Sanity Check (applied before scoring value dislocation):**
If the current price — AFTER the decline — still reflects Forward P/E > 60× OR
Price/Sales > 25×, set value dislocation score to **0/2** regardless of other
factors. A stock that was absurdly overvalued and is now merely very overvalued is
NOT a deep-value contrarian setup. Score it honestly. (PLTR at 82× forward P/E
after a 38% decline is the reference case for this check.)

**Score Interpretation:**
- **8–10**: 🟢 **HIGH CONVICTION** — Strong contrarian thesis. Staged entry appropriate.
- **6–7**: 🟡 **MODERATE CONVICTION** — Thesis holds but risk elevated. Start Tranche 1 only.
- **4–5**: 🟠 **SPECULATIVE** — Insufficient evidence. Exploratory only; very small position.
- **1–3**: 🔴 **AVOID** — Contrarian case too thin. Do not enter regardless of price drop.

**Cap rules:**
- If Check 2 was borderline (hybrid breakdown with genuine structural elements) → cap at **7/10**
- If Check 3 Override is active → cap at **6/10** (takes precedence over the 7/10 cap if both apply)
- Caps are cumulative in one direction only: the lower cap always wins.

---

### ━━━ PHASE 2 — ENTRY EXECUTION ━━━
*How do I enter, and when does each tranche trigger?*

---

### Catalyst Trigger Taxonomy

Use this table to classify each identified catalyst and map it to entry timing.
Stronger catalysts justify earlier and larger commitment. Weaker or binary catalysts
belong in later tranches only.

| Catalyst | Strength | Tranche Signal | Notes |
|---|---|---|---|
| Insider buying (open market, post-decline) | 🟢 Strong | T1 or T2 | Insiders buying after the stock has already fallen = high conviction signal |
| Overhang fully resolved (deal collapsed, probe closed, CEO confirmed) | 🟢 Strong | T1 — act quickly | These windows close fast; stock re-rates once the primary negative is removed |
| Analyst upgrades post-selloff | 🟡 Medium-Strong | T2 | Contrarian call from sell-side adds weight to recovery narrative |
| Earnings stabilisation / guidance re-issued at reset level | 🟡 Medium | T2 | Must show floor — one stabilising quarter is minimum confirmation |
| Buyback announcement at lows | 🟡 Medium | T1–T2 | Management confidence signal; verify buyback is not debt-funded (red flag if so) |
| New product or pipeline milestone | 🟡 Medium | T2–T3 | Depends on addressable opportunity size and timeline to revenue |
| Sector mean reversion or macro tailwind | 🟠 Variable | T2–T3 | Timing uncertain; do not use as sole catalyst for T1 entry |
| Strategic review or M&A speculation | 🟠 Variable | T2 only | Binary outcome — do not size heavily on unconfirmed speculation |
| No identifiable catalyst | 🔴 Weak | Do not enter | Price alone is not a catalyst. Wait for a trigger before committing capital. |

**Tranche mapping:** T1 = Tranche 1 (40%), T2 = Tranche 2 (35%), T3 = Tranche 3 (25%)

---

### Step 7 — Staged Entry Strategy

Contrarian plays are never bought all at once. Stage entry across 3 tranches to
manage the risk of a thesis taking time to play out.

```
TRANCHE 1 — 40% of position
Trigger: First exhaustion signals on weekly chart
         (Weekly RSI < 38, selling volume declining, price ≥ 25% off ATH)
Note:    Ideal to enter at or near a major OVERHANG RESOLUTION — the moment
         the primary reason for the decline is officially removed (deal falls
         apart, probe resolved, CEO confirmed, guidance re-issued). These
         windows close quickly. Monitor catalysts actively.

TRANCHE 2 — 35% of position
Trigger: Bottoming pattern beginning to confirm
         (Weekly RSI recovering above 40, price holding above swing low for
          3+ consecutive weeks, sector ETF still healthy)

TRANCHE 3 — 25% of position
Trigger: Early recovery confirmed
         (Weekly RSI > 50, MACD weekly crossover positive, price reclaims
          20-week SMA, at least one catalyst materialising in results)

STOP-LOSS FRAMEWORK
Hard stop:         Price breaks 15% below Tranche 1 entry → thesis challenged, exit
Soft invalidation: Breakdown classification shifts from temporary to structural
Timeline review:   No meaningful recovery within 18 months → re-evaluate fully
```

**⚠️ Mid-Cap Liquidity Note:** For mid-cap names ($2B–$10B market cap), verify
average daily dollar volume before sizing each tranche. Ensure the intended tranche
dollar amount does not exceed 10% of the stock's average daily dollar volume —
entering a position too large relative to liquidity increases execution cost and
creates exit risk if the thesis is later invalidated.

---

### Step 8 — Recovery Target Framework

```
Search: {TICKER} analyst price target 12-month forecast 2026 2027
Search: {TICKER} intrinsic value DCF fair value estimate
Search: {TICKER} historical P/E average 5-year valuation
```

Calculate three recovery scenarios from current price:

```
CONSERVATIVE (12M): 38.2% Fibonacci retracement of full drawdown
                    OR: Historical average P/E × current EPS estimate
BASE CASE (18M):    61.8% Fibonacci retracement of drawdown
                    OR: Analyst consensus mean price target
BULL CASE (24M):    Full recovery to pre-breakdown ATH (100% Fibonacci)
                    OR: DCF intrinsic value / fair value estimate

Report implied return % from current price for each scenario.
Cross-reference: if analyst consensus aligns with a Fibonacci level,
that is strong confluence and increases target confidence.
```

---

### ━━━ PHASE 3 — POST-ENTRY MONITORING ━━━
*What would invalidate my thesis after I'm in?*

---

## Thesis Invalidation Criteria

After entering a position, ANY of the following warrants immediate re-evaluation:

1. **Criminal charges filed** against company or leadership (vs. ongoing probe)
2. **Accelerating revenue decline** — two or more consecutive quarters worsening
3. **Core business unit divested under duress** (forced, not strategic)
4. **Credit rating downgraded to junk** — signals cash flow stress beyond temporary
5. **Sector ETF breaks into sustained downtrend** — the key tailwind is gone
   *(If Check 3 Override was active: further -10% ETF decline from override date, or ETF breaks 200-week SMA → exit immediately; the override rationale has collapsed)*
6. **18 months post-entry with no recovery evidence** — thesis timeline expired

---

## Output Format A — Full Contrarian Analysis

*(When HARD GATE passes and contrarian opportunity is confirmed)*

```
╔══════════════════════════════════════════════════════════════╗
  CONTRARIAN COMEBACK ANALYSIS: [TICKER] — [DATE]
  ⚠️  12–24 MONTH THESIS | THIS IS NOT A SHORT-TERM TRADE
╚══════════════════════════════════════════════════════════════╝

OPPORTUNITY VERDICT:  🟢 HIGH CONVICTION / 🟡 MODERATE / 🟠 SPECULATIVE
Contrarian Score:     X/10

THE THESIS IN ONE SENTENCE:
[Company] is a [sector] leader temporarily impaired by [event], while the
sector remains healthy — creating a [X]% dislocation from intrinsic value.

──────────────────────────────────────────────────────────────
BREAKDOWN ANALYSIS
──────────────────────────────────────────────────────────────
Type:            🟢 Event-Driven / 🟢 Failed Corporate Action /
                 🟡 Cyclical / 🟠 Guidance Reset
Trigger Event:   [What caused the crash — specific and factual]
ATH Price:       $XXX.XX  ([date] | split-adjusted if applicable)
Current Price:   $XXX.XX
Total Drawdown:  -XX.X% from ATH
Classification:  Temporary / Unclear (explain)

──────────────────────────────────────────────────────────────
SECTOR HEALTH
──────────────────────────────────────────────────────────────
Sector ETF:       [ETF ticker] — [Uptrend / Neutral / Downtrend]
Stock vs ETF:     Stock: -XX% | Sector ETF: +/-XX% | Spread: XXpts
Structural Theme: [Key multi-year tailwind for this sector]

──────────────────────────────────────────────────────────────
FUNDAMENTAL HEALTH
──────────────────────────────────────────────────────────────
Market Cap:      $XXB  ([Large-Cap / Mid-Cap] — calibration applied)
Debt-to-Equity:  X.X× → [Green / Yellow / Red]
Current Ratio:   X.X → [Green / Yellow / Red]
Free Cash Flow:  [Positive $XB / Negative / Burning $XM per quarter]
Revenue Trend:   [Stable / Declining — pace and direction]
Gross Margin:    XX% → [Stable / Compressing]
Value Trap Flags: X of 7 present → [None / list which ones apply]
Verdict:         [Fundamentals intact / Weakening / Disqualified]

──────────────────────────────────────────────────────────────
TECHNICAL PICTURE (WEEKLY CHART — SPLIT-ADJUSTED)
──────────────────────────────────────────────────────────────
200-week SMA:    $XXX  (price is [above / below / testing])
Weekly RSI:      XX.X → [Deeply Oversold / Recovering / Neutral]
Volume trend:    [Drying up / Capitulation spike seen / Recovering]
OBV:             [Turning up / Flat / Declining]
Bottoming signal: [Pattern forming / Not yet visible]

Fibonacci Levels  (ATH $XXX → Low $XXX | split-adjusted):
  38.2% target:  $XXX  (+XX% from current)
  61.8% target:  $XXX  (+XX% from current)
  100% target:   $XXX  (+XX% from current — full recovery)

──────────────────────────────────────────────────────────────
CONTRARIAN SCORE
──────────────────────────────────────────────────────────────
Breakdown severity & type:   X/2  [reason]
Sector health:               X/2  [reason]
Technical exhaustion:        X/2  [reason]
Value dislocation:           X/2  [reason | valuation sanity check result]
Catalyst pipeline:           X/2  [reason | note if overhang recently resolved]
TOTAL:                       X/10

──────────────────────────────────────────────────────────────
CATALYST PIPELINE
──────────────────────────────────────────────────────────────
Primary catalyst:    [Catalyst name] — [Strength] — [Expected timeline]
Secondary catalyst:  [If any — or None]
Insider activity:    [Buying / Neutral / Selling post-decline]
Overhang status:     [Resolved / Pending resolution / N/A]

──────────────────────────────────────────────────────────────
STAGED ENTRY PLAN
──────────────────────────────────────────────────────────────
Tranche 1 (40%):  $XXX–$XXX zone | Trigger: [specific condition]
Tranche 2 (35%):  $XXX–$XXX zone | Trigger: [specific condition]
Tranche 3 (25%):  $XXX–$XXX zone | Trigger: [specific condition]
Hard Stop:        $XXX  (-15% from Tranche 1 entry)
[Mid-Cap note if applicable: Avg daily vol $XM — max tranche = $XM]

──────────────────────────────────────────────────────────────
RECOVERY TARGETS
──────────────────────────────────────────────────────────────
Conservative (12M):  $XXX  (+XX% from current)
Base Case    (18M):  $XXX  (+XX% from current)
Bull Case    (24M):  $XXX  (+XX% from current)
Analyst consensus:   $XXX  (range: $XXX–$XXX | +XX% upside)

──────────────────────────────────────────────────────────────
THESIS INVALIDATION — WATCH FOR THESE
──────────────────────────────────────────────────────────────
• [Specific event that would confirm structural, not temporary, damage]
• [Specific sector development that would remove the tailwind]
• [Timeline: if no recovery evidence by X date, re-evaluate]
══════════════════════════════════════════════════════════════╝
```

---

## Output Format B — NO OPPORTUNITY Verdict

*(When HARD GATE fails — output this and STOP. No further analysis.)*

```
╔══════════════════════════════════════════════════════════════╗
  CONTRARIAN SCREEN: [TICKER] — [DATE]
╚══════════════════════════════════════════════════════════════╝

❌  NO CONTRARIAN OPPORTUNITY DETECTED

This analysis will not proceed to staged entry or recovery targets.
Producing one anyway would be intellectually dishonest and harmful.

GATE FAILED:  Check X — [Name of the check]

REASON:
[Clear, specific explanation. For a valuation reset: cite how the business is
 performing strongly (earnings beats, guidance raises) while the stock fell on
 multiple compression — and flag that even post-decline the stock is not cheap
 (cite current P/E or P/S). For a structural breakdown: cite specific evidence
 of moat erosion or secular decline. Be direct. No hedging.]

WHERE THIS TICKER BELONGS INSTEAD:
[Route to the correct skill: LT-MT Stock Analyzer for fundamental deep-dives on
 high-multiple growth stocks; Momentum Trading Skill for near-ATH setups.]
══════════════════════════════════════════════════════════════╝
```

---

## Reference Cases — The Four-Stock Calibration Set

These four live tests calibrate every future contrarian screen.

### ✅ UNH (2024–2026) — The Model Contrarian Play  Score: 9/10

| Gate | Signal | Data | Result |
|------|--------|------|--------|
| Check 1 | Drawdown ≥ 25% | -61% from $603 ATH to $234 low | ✅ Pass |
| Check 2 | Event-driven | CEO assassination + DOJ probe + CEO resignation | ✅ Pass |
| Check 3 | Sector (XLV) | XLV +14.5% in 2025 while UNH -61% | ✅ Pass |
| Check 4 | Viability | Revenue $447.6B (+12% YoY), OCF $19.7B, dividend held | ✅ Pass |
| Check 5 | Catalyst | Hemsley return, Medicare repricing, MCR normalisation | ✅ Pass |
| Outcome | +73% from lows in ~10 months | T1 ~$247 → current $408 | ✅ Validated |

*Benchmark question for every future analysis: "Is this situation more or less compelling than UNH at its low?"*

### ✅ NFLX (2025–2026) — Failed Corporate Action Play  Score: 8/10

| Gate | Signal | Data | Result |
|------|--------|------|--------|
| Check 1 | Drawdown ≥ 25% | -39.4% from $134.12 ATH (split-adjusted) | ✅ Pass |
| Check 2 | Failed corporate action | $82.7B WBD bid withdrawn; $2.8B termination fee received | ✅ Pass |
| Check 3 | Sector (XLC) | Streaming structurally intact, Netflix dominant | ✅ Pass |
| Check 4 | Viability | Q1 2026: Revenue +16% YoY, EPS +86% YoY, FCF $12.5B | ✅ Pass |
| Check 5 | Catalyst | WBD overhang fully resolved Jun 12, 2026; ad revenue doubling | ✅ Pass |
| Note | T1 entry window | Near 52W low of $75.01; stock at $81 when overhang resolved | Ongoing |

### ❌ NVDA (2026) — Near ATH; Check 1 Fails  Score: N/A

NVDA at $205 is only 13.3% below its $236.54 ATH. No drawdown, no dislocation.
The contrarian window was June 2025 at ~$142 (export restriction fears) — that
trade returned +66.5% by May 2026. Window closed. Route to Momentum Skill.

### ❌ PLTR (2026) — Business Accelerating; Check 2 Fails  Score: N/A

PLTR fell 38.3% from $207.52 ATH but Q1 2026 revenue grew 85% YoY and EPS beat
by 22%. The decline is pure multiple compression from 100× P/S peak — not an
event-driven shock. Post-decline the stock still trades at 82× forward P/E.
Valuation normalization is NOT a contrarian setup. Route to LT-MT Analyzer.

---

## Common Scenarios

| User says... | Action |
|---|---|
| "Is [TICKER] a contrarian play?" | Run HARD GATE first. Proceed or stop accordingly. |
| "Stock crashed 40–50%, should I buy?" | Large drawdown alone does NOT pass the gate. Run all 5 checks. |
| "Is [TICKER] the next UNH?" | Explicitly compare all 5 checks against the UNH benchmark table above. |
| "[TICKER] down in a hot sector" | Strong candidate — run full pipeline with high priority. |
| "[TICKER] fell despite beating earnings" | Likely valuation reset (PLTR pattern) → Check 2 will likely FAIL. |
| "Stock dropped on a failed acquisition" | Classic failed corporate action (NFLX pattern) → Check 2 likely PASS. |
| "Stock barely off highs" | Check 1 will FAIL (NVDA pattern). Route to Momentum Skill. |
| "Is this breakdown permanent or temporary?" | Focus on Step 1 Breakdown Classifier + Step 3 Value Trap check. |
| "When should I start buying?" | Focus on Catalyst Taxonomy + Step 7 Staged Entry — especially overhang resolution timing. |
| "Is it too late to buy [TICKER]?" | If T3 already triggered, assess remaining upside vs. recovery targets. |
| "Is this mid-cap contrarian safe?" | Apply Step 4 Fundamental Health Check with mid-cap calibration — stricter thresholds. |
| "Is [TICKER] a value trap?" | Run Step 3 Value Trap Warning Signs + Step 4 Fundamental Health Check first. |
| "Override the sector check for [TICKER]" | Present ETF data, verify Hard Block conditions not met, require rationale, apply 6/10 cap + degraded path. |
| "The sector ETF is down but the stock is different" | Classic override scenario. Show ETF stats, present 4 rationale options, let user decide before continuing. |

---

## ⚠️ Disclaimer

> This analysis is for informational and educational purposes only. It does not
> constitute financial advice. Contrarian investing carries significant risk —
> stocks that appear temporarily broken can and do become permanently impaired.
> Always conduct your own due diligence and consult a qualified financial advisor
> before making investment decisions. Past recoveries (including UNH 2025–2026)
> do not guarantee future results.
