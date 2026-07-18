---
name: contrarian-finder
description: >
  Scanner skill for US large-cap equities. Scans a curated universe of up to 450
  stocks across Dow Jones 30, Nasdaq-100, S&P 500 Top 200, and 11 SPDR Sector ETFs
  to find stocks that have declined ≥25% (default, user-adjustable) over the last
  5 trading days. Produces a ranked candidate shortlist — NOT a buy recommendation.
  Trigger on phrases like: "find contrarian candidates", "what stocks have crashed
  this week", "run contrarian finder", "scan for big decliners", "what's fallen 25%",
  "find beaten-down stocks", "contrarian scan", "weekly losers scan", "show me what
  crashed", "run the finder".
---

# Contrarian Finder

Scanner for US large-cap equities — identifies stocks that have fallen sharply over
the last **5 trading days** across a curated universe of up to **450 stocks**.
Outputs a ranked candidate shortlist. Holding period analysis and deep thesis
validation are handled separately by the **Contrarian Comeback Analyzer**.

---

## How This Skill Differs from Contrarian Comeback Analyzer

| | Contrarian Finder | Contrarian Comeback Analyzer |
|---|---|---|
| **Purpose** | Find candidates | Analyze one candidate |
| **Input** | No ticker needed — scans the universe | Single ticker |
| **Output** | Ranked shortlist table | Full 8-step analysis report |
| **Speed** | Up to 3-batch scan (~3–4 minutes total) | Deep research (~2–5 minutes) |
| **Question answered** | "What has crashed this week?" | "Is this crash a buying opportunity?" |

**Natural workflow:**
```
Contrarian Finder → ranked shortlist → user picks one → Contrarian Comeback Analyzer
```

The Finder surfaces names worth investigating. The Comeback Analyzer decides whether any of them are genuinely investable.

---

## Scanning Universe

Stocks are drawn from five tiers, assembled in priority order and deduplicated.
A stock appearing in multiple indexes is counted once — assigned to its highest-priority tier.

### Tier 1 — Dow Jones Industrial Average (30 stocks)
Blue-chip large-caps. All 30 included.

**FMP endpoint:** `GET /stable/dowjones-constituent`

### Tier 2 — Nasdaq-100 (100 stocks)
100 largest non-financial Nasdaq-listed companies. All 100 included.
Stocks already in Tier 1 are excluded.

**FMP endpoint:** `GET /stable/nasdaq-constituent`

### Tier 3 — S&P 500 Top 200 by Market Cap (~120–140 unique stocks)
Full S&P 500 constituent list fetched, sorted by market cap descending,
top 200 selected, then stocks already in Tiers 1–2 removed.
Typically yields ~120–140 unique additions — the second 100 (ranks 101–200) captures
large-cap names outside the tech-heavy DJ30/NDX100 universe: major financials
(JPM, BAC, WFC), healthcare (JNJ, MRK, PFE), energy (XOM, CVX), and industrials
that are well-covered by S&P 500 but underrepresented in the first two tiers.

**FMP endpoint:** `GET /stable/sp500-constituent`
Sort field: `marketCap` (descending). Take top 200. Deduplicate against Tiers 1–2.

### Tier 4 — SPDR Sector ETF Constituents (~remaining slots up to 450 total)
Holdings of all 11 SPDR sector ETFs, deduplicated against Tiers 1–3 and against
each other. Fills remaining capacity up to the 450-stock hard cap.
With Top 200 S&P 500, Tiers 1–3 typically yield ~250–270 unique stocks,
leaving ~180–200 slots for Tier 4 ETF constituents.

| ETF | Sector | Character |
|---|---|---|
| XLK | Technology | Largest sector, growth |
| XLV | Healthcare | Defensive |
| XLF | Financials | Cyclical |
| XLY | Consumer Discretionary | Growth |
| XLI | Industrials | Cyclical |
| XLC | Communication Services | Growth |
| XLP | Consumer Staples | Defensive |
| XLE | Energy | Volatile / Cyclical |
| XLB | Materials | Cyclical |
| XLU | Utilities | Stable / Income |
| XLRE | Real Estate | Income / Stable |

**FMP endpoint (per ETF):** `GET /stable/etf-holder?symbol=XLK` (repeat for each)

### Excluded Universes
- **Nasdaq Composite** (3,000+ stocks) — too large for browser-based API scanning
- **Wilshire 5000** (3,500+ stocks) — too large for browser-based API scanning

### Hard Cap
**Maximum 450 unique stocks** scanned per run. If Tier 4 ETF constituents exceed
the cap after deduplication, fill slots in ETF order: XLK → XLV → XLF → XLY →
XLI → XLC → XLP → XLE → XLB → XLU → XLRE.

---

## Execution Model — Up to Three-Batch Scan

The full universe is split into sequential batches of **150 stocks** to respect FMP API
rate limits (150 × 2 calls = 300/batch ≈ FMP Starter plan limit of 300/min).
Batch 3 only runs if the assembled universe exceeds 300 stocks.

```
STEP 1 — Assemble Universe
  Fetch constituent lists for: DJ30, NDX100, S&P 500, XLK…XLRE
  Deduplicate by tier priority
  Apply universe cap (≤450 stocks)
  Split into non-empty batches of 150:
    Batch 1 = stocks   1–150
    Batch 2 = stocks 151–300
    Batch 3 = stocks 301–N  (N ≤ 450) — only if universe > 300 stocks

STEP 2 — Batch 1 Scan (150 stocks)
  For each stock, fire in parallel:
    ① GET /stable/quote?symbol=TICKER          → price, marketCap, volume, avgVolume
    ② GET /stable/historical-price-eod/full
         ?symbol=TICKER&limit=7                → last 7 closing prices (5-day window)
  Optimization: if quote returns price < $10 or marketCap < $5B → skip history call
  As each call resolves → increment progress counter → update progress bar
  Collect all results

STEP 3 — Pause (60 seconds)
  Display countdown timer
  Show interim results: "X candidates found in Batch 1"

STEP 4 — Batch 2 Scan (stocks 151–300)
  Same as Step 2 · progress bar resets for Batch 2

STEP 5 — Pause (60 seconds, only if Batch 3 exists)
  Display countdown timer: "waiting before Batch 3"

STEP 6 — Batch 3 Scan (stocks 301–N, only if universe > 300)
  Same as Step 2 · progress bar resets for Batch 3

STEP 7 — Merge & Filter
  Combine all batch results
  Apply quality filters (price, market cap)
  Apply decline filter (≥ threshold over 5 trading days)
  Sort by 5-day decline ascending (largest decline first)
  Render results table
```

### Advanced Controls (Widget)
Two user-configurable settings are available via the **Advanced** panel in the widget:

| Control | Default | Options | Effect |
|---|---|---|---|
| **Batch size** | 150 | 50 / 100 / 150 / 200 | Stocks per batch — smaller = safer on rate-limited plans |
| **Max batches** | 3 | 2 / 3 | Cap at 300 stocks (2) or full 450 (3) |
| **Quality filter** | Standard | Standard ($10·$5B) / Relaxed ($5·$2.5B) | Minimum price and market cap to include a stock in scan |

Changing any Advanced setting takes effect on the **next scan run** — already-displayed
results are not retroactively affected.

---

## Quality Filters

Applied to every stock before decline calculation. Both conditions must be met.
Stocks failing either filter are silently excluded from results.

The quality filter preset is **user-configurable** in the Advanced panel. The selected
preset applies to the next scan — changing it after a scan completes has no effect on
already-fetched results (a re-run is required).

| Preset | Min Price | Min Market Cap | Use case |
|---|---|---|---|
| **Standard** (default) | ≥ $10.00 | ≥ $5 Billion | Large-cap focus — fewer, higher quality candidates |
| **Relaxed** | ≥ $5.00 | ≥ $2.5 Billion | Mid-cap inclusion — wider net, more candidates |

> **Standard:** A $5B+ company dropping ≥25% in 5 days is a major event — every result warrants attention.
>
> **Relaxed:** Useful on quiet market days when no large-caps qualify, or when you want
> to include mid-cap names in the candidate list. Expect more noise alongside signal.

---

## Decline Criterion

### Definition

```
5-Day Change % = (End Price − Start Price) / Start Price × 100
```

The **End Price** and **Start Price** depend on whether the market is open at the
time the scan is executed:

| Market State | End Price | Start Price | Historical fetch |
|---|---|---|---|
| **Market OPEN** | Current live price (`quote.price`) | Close 5 trading days ago (`historical[4].close`) | `limit=7` |
| **Market CLOSED** | Last closing price (`historical[0].close`) | Close 5 trading days ago (`historical[5].close`) | `limit=7` |

> **Why the index differs:** When the market is open, FMP's historical endpoint
> has not yet posted today's close. Yesterday's close sits at `historical[0]`,
> making 5 completed sessions back = `historical[4]`. When the market is closed,
> today's close is at `historical[0]`, so 5 sessions back = `historical[5]`.

### Market State Detection

```javascript
const todayStr  = new Date().toISOString().slice(0, 10); // e.g. "2026-06-11"
const marketClosed = historical[0].date === todayStr;

let endPrice, startClose;
if (marketClosed) {
  endPrice   = historical[0].close;  // today's close is confirmed
  startClose = historical[5].close;  // 5 completed sessions ago
} else {
  endPrice   = quote.price;          // current live intraday price
  startClose = historical[4].close;  // 5 completed sessions ago (yesterday = index 0)
}

const change5d = (endPrice - startClose) / startClose * 100;
```

Always fetch `limit=7` from the historical endpoint — this provides enough data
for both market states plus one row of buffer.

### Trading Day Rule

**Weekends and market holidays are excluded automatically.** FMP's historical
endpoint returns only actual trading sessions — there are no Saturday, Sunday,
or holiday rows in the data. The index arithmetic above therefore counts only
real trading days, never calendar days.

### Edge Cases

| Situation | Handling |
|---|---|
| Fewer than 6 historical rows returned | Skip stock — insufficient history |
| Market open but `quote.price` is null or 0 | Fall back to `historical[0].close`; if also null → skip |
| Stock was halted / zero volume on a day | Use the closing price as returned by FMP |
| Stock listed fewer than 6 trading days ago | Skip stock |
| `historical[0].date` is a future date (data error) | Treat as market closed; use `historical[0].close` as end price |

### Threshold Setting
Default: **25%** decline triggers inclusion in results.

User-adjustable (client-side, no re-scan needed):

| Option | Use case |
|---|---|
| 15% | Widest net — catches moderate selloffs |
| 20% | Moderate filter |
| **25%** | **Default** — meaningful crash signal |
| 30% | Tightest filter — only catastrophic drops |

Changing the threshold instantly re-filters the already-fetched result set.
It does **not** trigger a new API scan.

---

## FMP API Calls Summary

| Call | Endpoint | Per stock? | Purpose |
|---|---|---|---|
| Constituent list | `/stable/dowjones-constituent` | Once | DJ30 universe |
| Constituent list | `/stable/nasdaq-constituent` | Once | NDX100 universe |
| Constituent list | `/stable/sp500-constituent` | Once | S&P 500 Top 200 universe |
| ETF holdings | `/stable/etf-holder?symbol=XLK` | Once per ETF × 11 | Sector ETF universe |
| Quote | `/stable/quote?symbol=TICKER` | Per stock | Price, market cap, volume |
| History | `/stable/historical-price-eod/full?symbol=TICKER&limit=6` | Per stock (passing filter) | 5-day decline calculation |

Total API calls per run: ~15 (universe assembly) + up to ~900 (quote + history × 450 stocks, optimized)
Rate limit fit: 150 stocks × 2 calls = 300/batch ≈ FMP Starter plan limit of 300 calls/minute

---

## Progress Display

The widget must show live progress during each batch so the user knows the scan is running.

```
┌─────────────────────────────────────────────────────────┐
│  Scanning Batch 1 of 3                                  │
│  [████████████░░░░░░░░]  112 / 150 stocks               │
│  3 candidates found so far                              │
└─────────────────────────────────────────────────────────┘

──── Batch 1 complete ────────────────────────────────────
  3 candidates found · waiting 60 seconds before Batch 2
  [████████████████████]  Resuming in 28s...
──────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────┐
│  Scanning Batch 2 of 3                                  │
│  [████████░░░░░░░░░░░░]  78 / 150 stocks                │
│  1 additional candidate found                           │
└─────────────────────────────────────────────────────────┘

──── Batch 2 complete ────────────────────────────────────
  4 candidates found · waiting 60 seconds before Batch 3
  [████████████████████]  Resuming in 41s...
──────────────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────┐
│  Scanning Batch 3 of 3                                  │
│  [████░░░░░░░░░░░░░░░░]  45 / 150 stocks                │
│  0 additional candidates                                │
└─────────────────────────────────────────────────────────┘
```

**Progress bar behaviour:**
- Bar fills as each individual Promise settles (not when the whole batch completes)
- Counter increments on every resolved call — pass or fail
- Candidate count updates whenever a new qualifying stock is found
- Batch 2 bar starts from 0, independent of Batch 1

---

## Output Format

### Results Table (one row per qualifying stock)

Sorted by **5-Day Change %** ascending — largest decline at the top.

| Column | Source | Format |
|---|---|---|
| Ticker · Company | quote `symbol` + `name` | `UNH · UnitedHealth Group` |
| Sector | profile or ETF tier mapping | `Healthcare` |
| 5D Change | Calculated | `-31.4%` — red, bold |
| Current Price | quote `price` | `$412.50` |
| Market Cap | quote `marketCap` | `$380B` |
| Vol / Avg | quote `volume` ÷ `avgVolume` | `3.2×` — orange if > 2× |
| Found In | tier tracking during universe assembly | `S&P 500, XLV` |
| Action | Button | `Analyze →` — opens Contrarian Comeback |

**Color coding for 5D Change column:**
| Decline | Color |
|---|---|
| 15–19% | Orange |
| 20–24% | Red |
| 25–34% | Deep Red |
| ≥35% | Deep Red + bold |

### Zero Results State
When no stocks meet the criteria:
```
✅ Scan complete — No stocks declined ≥25% in the last 5 trading days
   across the scanned universe of 400 stocks.

   Try widening the threshold to 20% or 15% to see milder declines.
```

### Action Button Behaviour
Each row's `Analyze →` button opens:
```
contrarian-analysis.html?ticker=UNH&country=US&source=finder
```
The `source=finder` param allows the Contrarian Comeback page to note
"Referred from Contrarian Finder" in its output header.

---

## Volume Spike Interpretation

A high Vol/Avg ratio confirms the price move is driven by real market activity,
not a data error or illiquid trading.

| Vol / Avg | Signal |
|---|---|
| < 1× | Below-average — treat with caution, possible thin trading |
| 1–2× | Normal elevated volume |
| 2–5× | Significant volume spike — confirms the move |
| > 5× | Extreme volume — major institutional activity or news event |

---

## What the Finder Does NOT Do

- **Does not classify the breakdown type** — that is Step 1 of Contrarian Comeback
- **Does not run the 5-check Hard Gate** — that is Step 0 of Contrarian Comeback
- **Does not compute a Contrarian Score** — that is Step 6 of Contrarian Comeback
- **Does not recommend buying** — it only identifies names worth investigating
- **Does not scan intraday** — uses closing prices only; re-run daily for fresh results

---

## Caveats and Limitations

1. **Not a buy signal.** A ≥25% drop in 5 days is always a serious event. Many of
   these stocks will be falling for legitimate fundamental reasons and will continue
   declining. Always run the full Contrarian Comeback analysis before acting.

2. **Data is point-in-time.** Results reflect the most recent closing prices available
   from FMP. Re-scan the next trading day for updated results.

3. **API rate limits.** The 60-second gap between batches is a precaution against
   FMP rate throttling. Batch size of 150 is chosen to stay within FMP Starter plan's
   300 calls/minute limit. On slower connections, individual calls may time out — timed-out
   stocks are skipped and noted in a scan summary.

4. **ETF constituent coverage.** FMP's ETF holder endpoint may not always return a
   complete or perfectly up-to-date constituent list. The universe is best-effort,
   not guaranteed to be exhaustive.

5. **Market cap filter uses real-time data.** A stock that was $5B last week but has
   declined to $3.8B this week will be excluded. The filter is applied to the current
   market cap at time of scan.

---

## Reference: Index Routing Guide

| User says… | Finder scope to emphasise |
|---|---|
| "Scan tech stocks" | Highlight XLK results in Found In column |
| "Any Dow stocks crashing?" | Filter results to DJ30 tier |
| "What blue-chips are down?" | Filter to Tiers 1–2 (DJ30 + NDX100) |
| "Run the full scan" | All tiers, all batches — default behaviour |
| "Widen the threshold" | Adjust threshold control to 15% or 20% |
