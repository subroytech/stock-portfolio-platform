---
name: stock-preview-chart
description: >
  Reusable stock quick-preview chart component. Renders a 90-day dual-axis line
  chart (price left, % return right) plus 8 period-return pills (O/C, Prev, 5D,
  10D, 15D, 30D, 60D, 90D) for any ticker. Designed as a standalone JS component
  callable from any dashboard widget. Future measures (volume overlay, RSI,
  peer comparison, etc.) will be added to this skill as the component grows.
---

# Stock Preview Chart

Reusable quick-preview chart component for any ticker. Callable from any widget
on the dashboard. Currently used in the **Contrarian Comeback widget** on `index.html`.

---

## Purpose

Give the user an instant visual of a stock's price journey and return profile
without opening a full analysis page. Complements deep-analysis tools (Contrarian
Comeback Analyzer, Momentum Widget) by surfacing the raw price shape first.

---

## Visual Layout

```
┌─────────────────────────────────────────────────────┐
│ Apple Inc (AAPL)                      $182.50 ▼     │
│                                                     │
│ $240 ─────────────────────────────────────── +8%   │
│ $220 │        ╱‾‾╲                           0%    │
│ $200 │   ╱‾‾‾╯    ╲                         -10%   │
│ $180 │╱             ╲___                    -20%   │
│      └─────────────────────────────────────        │
│       90D   60D   30D   15D  10D  5D  Prev Today   │
│ ─────────────────────────────────────────────────  │
│  [C]   [Prev]  [5D]  [10D] [15D] [30D] [60D] [90D] │
│ -1.2%  -3.4%  -8.1% -11.2% -14% -19%  -22%  -23%  │
└─────────────────────────────────────────────────────┘
```

---

## Chart Specification

### Type
Chart.js 4.4.0 — Line chart with **dual Y-axis**:
- **Left Y-axis (`y`)** — Absolute price in USD (`$XXX.XX`)
- **Right Y-axis (`yPct`)** — % return from the starting point (day 90) to current

Both axes share the same single price line. Chart.js derives the right axis scale
automatically from the indexed % values computed at render time.

### Data
- **X-axis:** Last 90 trading-day dates (oldest → newest, left → right)
- **Price dataset:** `data[89].close` → `data[0].close` (oldest to newest)
  - When market is **open**: append `quote.price` as the rightmost point
  - When market is **closed**: `data[0].close` is already the latest point
- **% dataset:** Index each price to 100 at the leftmost point, then convert to %:
  ```javascript
  const base = prices[0]; // oldest price (day 90)
  const pctSeries = prices.map(p => (p - base) / base * 100);
  ```

### Styling
- Line colour: `var(--accent)` (#3b82f6) — blue
- No point dots (`pointRadius: 0`)
- Line tension: `0.2`
- Grid: subtle (`rgba(226,232,240,.6)` light / `rgba(51,65,85,.5)` dark)
- Both axes tick colour: `var(--text-muted)`
- Right axis ticks formatted as `+X.X%` / `-X.X%`
- Left axis ticks formatted as `$XXX`

---

## Period Return Pills

8 pills displayed in a horizontal row below the chart.

### Pill definitions

| Label | Market OPEN | Market CLOSED |
|---|---|---|
| **O** (green) | `(quote.price − data[0].close) / data[0].close × 100` | *not shown* |
| **C** (red/muted) | *not shown* | `(data[0].close − data[1].close) / data[1].close × 100` |
| **Prev** | `(quote.price − data[1].close) / data[1].close × 100` | `(data[0].close − data[2].close) / data[2].close × 100` |
| **5D** | `(quote.price − data[5].close) / data[5].close × 100` | `(data[0].close − data[6].close) / data[6].close × 100` |
| **10D** | `(quote.price − data[10].close) / data[10].close × 100` | `(data[0].close − data[11].close) / data[11].close × 100` |
| **15D** | `(quote.price − data[15].close) / data[15].close × 100` | `(data[0].close − data[16].close) / data[16].close × 100` |
| **30D** | `(quote.price − data[30].close) / data[30].close × 100` | `(data[0].close − data[31].close) / data[31].close × 100` |
| **60D** | `(quote.price − data[60].close) / data[60].close × 100` | `(data[0].close − data[61].close) / data[61].close × 100` |
| **90D** | `(quote.price − data[90].close) / data[90].close × 100` | `(data[0].close − data[91].close) / data[91].close × 100` |

### Market state detection
```javascript
const todayStr   = new Date().toISOString().slice(0, 10);
const marketOpen = data[0].date !== todayStr;
const currentPx  = marketOpen ? quote.price : data[0].close;
const offset     = marketOpen ? 0 : 1; // when closed, data[0]=today so shift back 1
```

### Pill styling
- **Positive %** → green pill: `background: rgba(34,197,94,.12); color: #15803d`
- **Negative %** → red pill: `background: rgba(239,68,68,.12); color: #991b1b`
- **O label** → always green border regardless of % value (market is open = live)
- **C label** → always red/muted border regardless of % value (market is closed)
- Dark mode: green `#4ade80`, red `#f87171`

---

## API Calls

Two parallel calls fired on ticker entry (Enter key or trigger button):

```javascript
const [quoteRes, histRes] = await Promise.allSettled([
  fetch(`${FMP}/quote?symbol=${ticker}&apikey=${key}`),
  fetch(`${FMP}/historical-price-eod/full?symbol=${ticker}&limit=96&apikey=${key}`)
]);
```

| Call | Endpoint | Data used for |
|---|---|---|
| Quote | `/stable/quote?symbol=TICKER` | Current price, today's % change, company name |
| History | `/stable/historical-price-eod/full?symbol=TICKER&limit=96` | 90-day line chart + all 8 period calculations |

`limit=96` provides safe headroom: when the market is open the index offset
shifts by 1, requiring up to index `[91]` for the 90D pill. 96 entries guarantees
no out-of-bounds access in either market state.

---

## Public API (JS component)

```javascript
// Render the chart into any container element
renderStockPreviewChart(ticker, containerId);

// Destroy and clean up (call before re-rendering or on widget reset)
destroyStockPreviewChart(containerId);
```

`containerId` is the `id` of the `<div>` that will receive the chart HTML.
The component manages its own Chart.js instance internally — the caller
never touches the chart object directly.

---

## Component File

`js/stock-preview-chart.js`

Loaded via `<script src="js/stock-preview-chart.js">` in `index.html`,
after `js/config.js` and `js/utils.js` (depends on `getFMPKey()` and `fmt$`).

---

## Future Measures (planned)

Items to be added to this skill as the component evolves:

- **Volume overlay** — bar series on a third y-axis (right-2), showing relative volume vs 90-day average
- **RSI line** — weekly RSI plotted as a secondary line in a sub-chart below the price chart
- **Peer comparison** — overlay a second line for a sector ETF or peer stock, both indexed to 100
- **Moving averages** — 20D and 50D SMA overlaid on the price line
- **Earnings markers** — vertical dotted lines at earnings dates within the 90-day window

---

## Caveats

- **FMP API key required.** Same key used by Live Prices and Momentum widgets.
- **Trading days only.** FMP historical endpoint returns only actual sessions —
  weekends and holidays are absent. All period indices count trading days, not calendar days.
- **No intraday data.** The line chart uses EOD closing prices. When the market is
  open, the rightmost point is the live quote price (a single intraday data point
  appended to the close series) — not a continuous intraday chart.
- **Split-adjusted prices.** FMP returns split-adjusted historical data by default.
  A recent stock split will not create an artificial cliff in the chart.
