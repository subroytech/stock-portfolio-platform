# Source App — Complete Function Reference
> Source: `../CreateStockPortfolioViewWOSkill`
> Purpose: Implementation guide for porting each module to the backend platform.
> Last updated: 2026-07-08 (2 patches: §3/§4/§5 + API summary for "Today's $ Performance", then §3's `renderTodayPerformancePies()` again for the Gainers/Losers header totals — full regeneration was 2026-07-07, superseding the 2026-07-03 version)

---

## Table of Contents

1. [config.js — Constants & Seed Data](#1-configjs--constants--seed-data)
2. [utils.js — Shared Utilities](#2-utilsjs--shared-utilities)
3. [portfolio.js — State, Parsers, Metrics, Charts, Table](#3-portfoliojs--state-parsers-metrics-charts-table)
4. [portfolio-performance.js — Performance Widget](#4-portfolio-performancejs--performance-widget)
5. [live-prices.js — Live Market Prices](#5-live-pricesjs--live-market-prices)
6. [momentum.js — Momentum Analysis Widget](#6-momentumjs--momentum-analysis-widget)
7. [momentum-help.js — Tooltip Content](#7-momentum-helpjs--tooltip-content)
8. [contrarian-finder.js — Contrarian Finder Scanner](#8-contrarian-finderjs--contrarian-finder-scanner)
9. [stock-preview-chart.js — Stock Preview Chart](#9-stock-preview-chartjs--stock-preview-chart)
10. [app.js — Entry Point & Wiring](#10-appjs--entry-point--wiring)

---

## 1. `config.js` — Constants & Seed Data

**Role:** Loaded first on every page. Defines all static lookup tables. No functions — pure data. Unchanged since the last porting pass.

---

### `PAGE_SIZE`
- **Type:** constant (`number`)
- **Value:** `20`
- **Used by:** `portfolio.js` — controls rows per page in the holdings table.

---

### `COLORS`
- **Type:** constant (`string[]`)
- **Value:** 15 hex color strings (blue, purple, pink, amber, green…)
- **Used by:** `portfolio.js` → `renderPieChart()` to color doughnut slices.

---

### `TICKER_SECTORS`
- **Type:** constant (`object` — ticker → sector string)
- **Size:** ~130 tickers across 11 sectors + ETFs
- **Purpose:** Fallback sector lookup when a brokerage export omits the sector column (Fidelity does this). Also used by the Robinhood parser to assign sectors.
- **Sectors covered:** Technology, Communication Services, Consumer Discretionary, Consumer Staples, Healthcare, Financials, Industrials, Energy, Real Estate, Materials, Utilities, ETFs
- **Porting note:** Move this into the backend as a seed data file (`seeds/ticker_sectors.js`). Already ported — confirm against the version in `backend/src/data/`.

---

### `HEADER_ALIASES`
- **Type:** constant (`object` — canonical field → string[])
- **Purpose:** Maps every known brokerage column name variant to a canonical field name. Powers the `mapHeaders()` function in the parser.

| Canonical Field | Example aliases |
|---|---|
| `symbol` | `symbol`, `ticker`, `stock`, `sym`, `security id` |
| `name` | `company name`, `company`, `description`, `stock name` |
| `quantity` | `quantity`, `shares`, `qty`, `units` |
| `purchasePrice` | `purchase price`, `avg cost`, `average cost basis` |
| `currentPrice` | `current price`, `price`, `market price`, `last price` |
| `marketValue` | `market value`, `current value`, `total value` |
| `gainLossDollar` | `gain/loss $`, `total gain/loss dollar` |
| `sector` | `sector`, `industry`, `sub-asset classification` |
| `purchaseDate` | `purchase date`, `date`, `buy date` |

- **Porting note:** Already ported to `backend/src/data/header_aliases.js`. Keep in sync.

---

### `EMPOWER_SECTOR_MAP`
- **Type:** constant (`object` — lowercased Empower category → normalized sector)
- **Purpose:** Translates Empower brokerage's verbose sub-asset classification strings into the app's sector vocabulary.

| Empower string | Maps to |
|---|---|
| `exchange-traded funds` | `ETFs` |
| `common stocks` | `Equities` |
| `fdic eligible bank deposits` | `Cash` |
| `cash` | `Cash` |
| `money market funds` | `Cash` |

- **Porting note:** Already ported to `backend/src/data/empower_sector_map.js`.

---

## 2. `utils.js` — Shared Utilities

**Role:** Must be the first app script loaded on every page. Defines shared formatters, API base URLs, API key helpers, shared indicator math, and the core FMP fetch wrapper. All other modules depend on it. **`fmpGet` was substantially rewritten this session** — it's now the single shared fetch implementation for the entire app (previously there were 4 divergent hand-rolled fetch wrappers scattered across `live-prices.js`, `momentum.js`, and `contrarian-finder.js`).

---

### API Base URLs
```
FMP     = 'https://financialmodelingprep.com/stable'
FMP3    = 'https://financialmodelingprep.com/v3'
FMP4    = 'https://financialmodelingprep.com/v4'
FINNHUB = 'https://finnhub.io/api/v1'
```
- **Porting note:** In the backend, these are replaced by `src/config/env.js` which reads keys from `.env`. Frontend never needs the base URLs once the backend proxy is in place.

---

### `getFMPKey()` / `setFMPKey(k)`
- **Action:** Read/write the FMP API key from `localStorage` key `fmp-api-key`.
- **Returns:** `string` (empty string if not set or localStorage unavailable)
- **Porting note:** In the platform, the key lives server-side in `.env`. Frontend sends requests to the backend proxy — no key exposure.

---

### `getFinnhubKey()` / `setFinnhubKey(k)`
- **Action:** Read/write the Finnhub API key from `localStorage` key `finnhub-api-key`.
- **Porting note:** Same as above — moves server-side.

---

### `getTheme()` / `setTheme(t)` / `flipTheme()`
- **Action:** Get/set/toggle the dark/light theme. Writes `data-theme` attribute to `<html>` and persists to `localStorage` key `pf-theme`.
- **Porting note:** Frontend-only concern. Keep in frontend, drive from user preferences table in Phase 2.

---

### `fmt$(v)`
- **Action:** Format a number as a USD currency string with 2 decimal places.
- **Input:** `number | null`
- **Output:** `'$1,234.56'` or `'—'` if null
- **Example:** `fmt$(12345.6)` → `'$12,345.60'`

---

### `fmtB(v)`
- **Action:** Format a large number in compact notation.
- **Output:** e.g. `'1.23T'`, `'456.78B'`, `'89.1M'`, or raw locale string
- **Used by:** Market cap display throughout the app.

---

### `fmtPct(v, d=1)`
- **Action:** Format a percentage with sign prefix.
- **Output:** `'+12.3%'` or `'-4.5%'`

---

### `fmtX(v)`
- **Action:** Format a ratio with `×` suffix.
- **Output:** `'2.5×'` or `'—'`

---

### `esc(s)`
- **Action:** HTML-escape a string (replaces `&`, `<`, `>`).
- **Used by:** Any place user-sourced or API-sourced strings are injected into HTML.

---

### `fmtNum(n)`
- **Action:** Format a number with locale-style commas. Returns `'—'` for null/NaN.
- **Used by:** Holdings table quantity column.

---

### `parseNum(v)`
- **Action:** Parse a string to a float, stripping `$`, `%`, `,` characters.
- **Input:** Any value (string, number, null)
- **Output:** `number | null`
- **Used by:** All parsers — converts raw CSV cell values to numbers.

---

### `SECTOR_ETF`
- **Type:** constant (`object` — sector name → SPDR ETF ticker)
- **Purpose:** Maps FMP sector names to their benchmark ETF. Used in analysis pages for sector context.

---

### `calcSMA(a, n)` / `calcRSI(a, n=14)` / `calcBB(a, n=20)`
- **Type:** pure functions, no DOM/network dependency
- **Purpose:** Shared indicator math, promoted here from private per-widget copies in `momentum.js` and `contrarian-finder.js` so both the Momentum Analysis widget and the Contrarian Finder's "Strength List" screen (see §8) use identical formulas.
  - `calcSMA(a, n)`: Simple Moving Average of the first `n` elements (array is newest-first).
  - `calcRSI(a, n=14)`: Wilder's RSI. Reverses to oldest-first, computes per-period gain/loss, seeds with a simple average of the first `n` periods, then applies Wilder smoothing for the rest. Returns a single current value. **Note:** returns `100` whenever there are zero losses in the window — including a perfectly flat price series, not just a strictly-rising one. This is the formula's literal definition, not a "neutral 50" fallback.
  - `calcBB(a, n=20)`: Bollinger Bands(20, ±2σ) from the first `n` elements. Returns `{ upper, mid, lower, bw }` where `bw = 4σ/mid` (bandwidth).
- **Test coverage:** These three now have a Node test suite (`tests/utils.test.js`, run via `node --test tests/*.test.js`) — no dependencies, using Node's built-in test runner. Verifies known input/output pairs (strictly increasing/decreasing price series for RSI, flat and alternating series for BB).
- **Porting note:** Straightforward to port verbatim into a backend `indicators.js`/`momentum.service.js` helper — already done per the sister repo's `momentum.service.js`. Confirm the ported version's RSI/BB formulas match exactly (same Wilder-smoothing and bandwidth definitions), since a fixed-window recompute over more/less history than the frontend uses (130 days for Momentum, 60 days for Contrarian Finder's strength screen) can shift the current RSI value slightly due to its path-dependent smoothing.

---

### `fmpGet(url, opts)`
- **Type:** `async function`
- **Input:** `url: string`, `opts: { timeoutMs?: number }` (default `timeoutMs: 20000`)
- **Action:** The single shared fetch wrapper for every FMP call in the app.
  - Wraps the request in an `AbortController`, aborting after `timeoutMs` so a hung request can't block the UI indefinitely.
  - **HTTP 402** (plan-tier restriction) → resolves to `null` (treated as "no data available", not an error — several endpoints on the current FMP plan return this).
  - **HTTP 401 / 403** → throws `'Invalid or expired FMP API key.'`
  - **HTTP 429** → throws `'FMP rate limit reached. Please wait a moment before retrying.'`
  - Any other non-OK status → throws `HTTP {status}: {first 120 chars of body}`
  - A 200 response whose JSON body contains `{"Error Message": ...}` (FMP's own invalid-key signal) → throws `'Invalid or expired FMP API key.'`
- **Usage pattern:** Always call via `Promise.allSettled()` at the call site to handle per-ticker failures gracefully.
- **History this session:** Before 2026-07-07 there were 4 separate implementations of this exact logic — `utils.js`'s own (no timeout), `live-prices.js`'s inline fetch (15s timeout, only special-cased 402), `momentum.js`'s inline fetch (20s timeout, checked 401/403/429), and `contrarian-finder.js`'s `cfFetch()` (no timeout at all, silently swallowed every error into `{ok:false}` instead of throwing). All three other call sites were migrated onto this one function; `cfFetch` was deleted entirely.
- **Porting note:** This is exactly the status-code handling logic the backend's FMP proxy service should replicate for parity (402→"no data", 401/403→auth error, 429→rate-limit error, timeout guard). `fmpGet` itself disappears from the frontend once the proxy is wired up — the frontend will call the backend's own `/quotes`-style endpoints instead, which already exist per the sister repo's Phase 1 scaffolding.

---

## 3. `portfolio.js` — State, Parsers, Metrics, Charts, Table

**Role:** The core module. Wrapped in an IIFE. Owns the global state object `S`, all file parsers, dashboard rendering, the holdings table, chart rendering, export/print functions, and localStorage persistence. **Chart rendering extended 2026-07-08** — see `getTodayDollarChanges()`/`renderTodayPerformancePies()`/`renderAllocationView()`/`renderBarChart()` below; parsers/table/metrics are unchanged.

---

### State Object `S`
```js
S = {
  raw: [],           // current holdings array (mutated by live prices)
  original: [],      // snapshot at upload time (used by Reset)
  filtered: [],      // search/filter result subset
  cashAmount: 0,     // total cash rows extracted from upload
  sortCol: null,     // active sort column key
  sortDir: 'asc',
  page: 1,
  query: '',         // search query string
  pieMode: 'sector', // 'sector' | 'stock' | 'today' (added 2026-07-08 — Allocation widget's dual-pie $ view)
  barMode: 'outlier',// 'outlier' | 'all'
  theme: '...',
  xDayOverride: null,    // Map<ticker, returnPct> | null — performance bar data
  xDayN: 5,             // days value for performance chart title
  xDayMode: 'trading days',
  perfHistoryMap: null,  // Map<ticker, hist[]> | null — cached EOD history
  activePerfTab: '1D',
}
```

Each holding object in `S.raw` has:
```js
{
  symbol, name, quantity, purchasePrice, currentPrice, sector, purchaseDate,
  costBasis,    // quantity × purchasePrice
  currentValue, // quantity × currentPrice
  gainLoss,     // currentValue - costBasis
  returnPct,    // ((currentPrice - purchasePrice) / purchasePrice) × 100
  allocation,   // currentValue / totalPortfolioValue × 100
}
```

---

### `applyTheme(t)`
- **Action:** Sets `S.theme`, writes `data-theme` to `<html>`, updates the theme icon SVG, and re-renders all charts.
- **Triggers:** On page load (reads `localStorage`) and when the theme toggle button is clicked.

---

### `mapHeaders(headers)`
- **Input:** `string[]` — raw CSV column headers
- **Output:** `object` — maps canonical field names to their column index
- **Action:** Normalizes headers (lowercase, trim, replace `_/-` with space) then looks them up in `HEADER_ALIASES`. First match wins.
- **Used by:** `parseGenericCsv()`

---

### `parseGenericCsv(text)`
- **Input:** `string` — raw CSV/Excel-converted-to-CSV text
- **Output:** `{ data: holding[], errors: string[], cashAmount: number }`
- **Action:**
  1. Parses with PapaParse (header mode)
  2. Maps headers via `mapHeaders()`
  3. Validates required columns: `symbol`, `quantity`, `currentPrice`
  4. Iterates rows:
     - Cash rows (`USD999997`, `DIDA`, `**` prefix, `PENDING ACTIVITY`) → accumulate into `cashAmount` (handles parenthesized negatives like `(123.45)`), skip
     - Invalid quantity/price → log to `errors`, skip
     - Missing purchase price → derives from `(marketValue - gainLoss) / quantity` if available, else falls back to current price
     - Sector resolution: Empower map → `TICKER_SECTORS` → raw CSV value → `'Unknown'`
  5. Computes `costBasis`, `currentValue`, `gainLoss`, `returnPct` per row
- **Supports:** Fidelity (no sector column), Empower (verbose sector strings), any generic CSV matching the alias map

---

### `isRobinhoodTxt(text)`
- **Input:** `string` — raw file text
- **Output:** `boolean`
- **Action:** Scans the first 15 lines for Robinhood's 7-line fixed header signature: `Name, Symbol, Shares, Price, Average cost, Total return, Equity`. Returns `true` if found.

---

### `parseRobinhoodTxt(text)`
- **Input:** `string` — Robinhood `.txt` export
- **Output:** `{ data: holding[], errors: string[], cashAmount: 0 }`
- **Action:**
  1. Splits text into non-empty lines
  2. `findSectionStart()`: locates the first line of data after a 7-line header block (Stocks or Crypto)
  3. `parseGroup(pos, isCrypto)`: reads one 7-line block into a holding object
     - Lines: `Name, Symbol, Shares/Quantity, Price, Average cost, Total return (ignored), Equity`
     - `Total return` line is ignored — Robinhood strips the sign
     - Gain/Loss derived as `equity - costBasis`
     - Sector: `'Crypto'` for crypto section, else `TICKER_SECTORS[sym] || 'Unknown'`
  4. Parses Stocks section, then Crypto section (different header: `Quantity` vs `Shares`)
  5. `cashAmount` always 0 (Robinhood has no cash rows)

---

### `parseFile(text, filename)`
- **Action:** Dispatcher. Calls `isRobinhoodTxt()` → if true, `parseRobinhoodTxt()`; else `parseGenericCsv()`.
- **Used by:** `loadData()`

---

### `loadData(text, filename)`
- **Action:** Top-level file load handler.
  1. Calls `parseFile()` to get `{ data, errors, cashAmount }`
  2. Computes `allocation` percentages for each holding
  3. Writes to `S.raw`, `S.original`, `S.filtered`, `S.cashAmount`
  4. Persists to `localStorage` (`pf-data`, `pf-cash`)
  5. Calls `renderAll()`, then triggers `fetchPerfHistory()` (performance widget auto-fetch)
  6. Updates upload feedback UI
- **Error path:** Shows error message in upload feedback, re-shows the upload form

---

### `clearDashboard()`
- **Action:** Resets the entire dashboard to empty state.
  1. Hides dashboard content, shows upload section
  2. Destroys Chart.js instances
  3. Calls `resetLiveSection()` (live-prices.js)
  4. Clears `S.raw`, `S.filtered`, `S.original`, `S.cashAmount`, `clearPerfState()`
  5. Removes `pf-data` and `pf-cash` from localStorage
  6. Resets header stats to `'—'`

---

### `processFile(file)`
- **Action:** FileReader wrapper. Detects file type (CSV/TXT vs XLSX), reads it appropriately, calls `loadData()`.
- **For Excel:** Uses XLSX.js to convert the first sheet to CSV text via `xlsxSheetToCsv()`.
- **Triggered by:** File input change, drag-and-drop, browse button.

---

### `xlsxSheetToCsv(ws, wb)`
- **Input:** XLSX worksheet object
- **Output:** `string` — CSV text
- **Action:** Converts sheet to array-of-arrays. Scans first 20 rows to find the actual header row (matching `HEADER_ALIASES`). Slices from that row down. Properly escapes commas/quotes in cell values.

---

### `renderMetrics(data)`
- **Input:** `holding[]`
- **Action:** Computes and renders the 4 KPI cards:
  - **Total Portfolio Value** = equity + cash (equity-only for Gain/Loss and Return)
  - **Cash** = `S.cashAmount` + % of total
  - **Cost Basis** = sum of `costBasis`
  - **Total Gain/Loss** = equity gain/loss
  - **Overall Return** = `gainLoss / costBasis × 100`
  - Colors the Gain/Loss and Return cards green/red
- Also calls `updateHeaderStats()`.

---

### `updateHeaderStats(tv, gl, ret, count)`
- **Action:** Writes values to the sticky page header bar (Total Value, Gain/Loss, Return, # Holdings). Shows `'—'` when `tv` is 0.

---

### `renderSummary(data)`
- **Input:** `holding[]`
- **Action:** Renders the 3 summary cards: Best Performer (highest returnPct), Worst Performer, Largest Position (highest currentValue).

---

### `chartColors()`
- **Output:** `object` — theme-appropriate colors for Chart.js (`grid`, `tick`, `bg`, `border`, `text`)
- **Used by:** `renderPieChart()`, `renderBarChart()`

---

### `renderPieChart(data)`
- **Input:** `holding[]`
- **Action:** Renders the Allocation doughnut chart using Chart.js.
  - **Sector mode:** Groups `currentValue` by `sector`, sorts descending, top 19 + `'Other'`
  - **Stock mode:** Sorts holdings by `currentValue`, top 19 + `'Other'`
  - Destroys existing chart instance before recreating
  - Tooltip shows dollar value and percentage of total
- Only rendered when `S.pieMode` is `'sector'`/`'stock'` — see `renderAllocationView()` below for the third `'today'` mode.

---

### `getTodayDollarChanges()` (new 2026-07-08, exposed as `window.getTodayDollarChanges`)
- **Output:** `Array<{ symbol, name, dollarChange }>`
- **Action:** Merges Live Prices' two price maps (`window.lastLivePriceMap` + `window.lastLiveAllOthersPriceMap` — see §5) and, for every holding with an entry in either, computes `dollarChange = quantity × changeDollar`. Empty array means Live Prices hasn't been refreshed yet.
- **Used by:** `renderTodayPerformancePies()` (this file) and `portfolio-performance.js`'s `renderTodayDollarTab()` (§4) — the single shared computation both new "Today's $" UI surfaces consume.
- **Porting note:** `changeDollar` already reflects "today's change if market open, previous session's if closed" (an FMP `/quote` field), so no separate open/closed detection logic exists or is needed here.

---

### `renderTodayPerformancePies()` (new 2026-07-08, extended same day — see header-totals note below)
- **Action:** Renders two Chart.js doughnuts side by side into `#pieChartUp`/`#pieChartDown` — Gainers (positive `dollarChange`, sorted descending) and Losers (negative `dollarChange`, sorted ascending, sliced by `Math.abs()`). Every stock still gets its own slice and tooltip (ticker + signed `$` amount via `fmt$`).
- **Header totals (added same day, commit `bfdb23c`):** `#allocGainersLbl`/`#allocLosersLbl` are updated each render to `"Gainers ($1,234.56)"` / `"Losers ($-567.89)"` — the sum of `dollarChange` across **all** gainers/losers respectively (not just the top-8 legend subset), formatted with the same app-wide `fmt$()` used everywhere else (negatives render dollar-sign-first, e.g. `$-567.89`, not `-$567.89`).
- **Legend:** capped to the top 8 entries by magnitude via a `generateLabels` override (`Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart).slice(0,8)`) — this only shortens the legend list, it does **not** bucket or drop any underlying slice/data.
- Shows/hides `#allocTodayRow` (the two-canvas wrapper) and `#allocTodayPlaceholder` (idle prompt) based on whether `getTodayDollarChanges()` returned anything.
- Two new module-level Chart.js instances: `pieChartUp`, `pieChartDown` (alongside the existing `pieChart`/`barChart`).

---

### `renderAllocationView()` (new 2026-07-08)
- **Action:** Dispatches the Allocation card's rendering based on `S.pieMode`:
  - `'today'` → hides the single `#pieChart` canvas, calls `renderTodayPerformancePies()`
  - `'sector'`/`'stock'` → hides the dual-pie wrapper/placeholder, shows `#pieChart`, calls `renderPieChart(S.raw)`
- Called by `renderCharts()` (below) and by all three Allocation toggle button click handlers (`#toggleSector`/`#toggleStock`/`#toggleTodayPerf`), via a shared `setPieToggleActive(activeId)` helper that keeps the 3 toggle buttons mutually exclusive.
- **Because this is part of the existing `renderAll()` → `renderCharts()` chain, the `'today'` pie view auto-refreshes on every Live Prices refresh for free** — no new cross-file hook was needed (contrast with `portfolio-performance.js`'s new tab in §4, which is *not* part of that chain and only updates lazily on click).

---

### `renderBarChart(data, overrideReturns, valueMode = 'pct')` (extended 2026-07-08 — new 3rd param)
- **Input:** `holding[]`, `Map<ticker, returnPct|dollarChange> | undefined`, `valueMode: 'pct' | 'dollar'`
- **Action:** Renders the Performance horizontal bar chart.
  - If `overrideReturns` provided: uses the map's values (performance widget data, in whichever unit `valueMode` implies)
  - If not provided: uses each holding's all-time `returnPct` (always percent — `valueMode` is only meaningful when `overrideReturns` is passed)
  - Tickers absent from `overrideReturns` map return `null` and are filtered out (not shown)
  - **Outlier mode:** Top 13 advances + top 12 declines from full set, merged best→worst
  - **All mode:** All holdings sorted best→worst
  - Bar colors: green for positive, red for negative
  - **`valueMode==='dollar'`:** y-axis ticks and tooltip use `fmt$()` instead of `fmtPct()`/`%`; `#perfChartTitle` reads `"Today's $ Gain/Loss"` instead of the period label. This is the only behavioral difference — sorting, Outlier/All mode, and bar coloring are shared code paths, not duplicated.
  - Updates the `#perfChartTitle` element
- **Exposed as:** `window.renderBarChart` for `portfolio-performance.js` — now called with a 3rd `'dollar'` argument from the new `renderTodayDollarTab()` (§4)

---

### `renderCharts()`
- **Action:** Orchestrates chart rendering.
  - Calls `renderAllocationView()` (was a direct `renderPieChart()` call before 2026-07-08 — now dispatches per `S.pieMode`, see above)
  - If `S.xDayOverride` exists: hides placeholder, calls `renderBarChart()` with the override
  - If not: destroys bar chart, shows placeholder

---

### `applyFilter()`
- **Action:** Filters `S.raw` into `S.filtered` based on `S.query` (matches symbol, name, or sector). Resets `S.page = 1`.

---

### `applySort()`
- **Action:** Sorts `S.filtered` in place by `S.sortCol` and `S.sortDir`. No-op if no sort column set.

---

### `renderTable()`
- **Action:** Renders the paginated holdings table.
  1. Calls `applySort()`
  2. Paginates `S.filtered` using `PAGE_SIZE` (20) and `S.page`
  3. Updates sort indicators on `<th>` elements
  4. Renders rows: Symbol, Name (truncated at 22 chars), Sector, Qty, Purchase Price, Current Price, Current Value, Gain/Loss (colored), % Return (badge), Allocation %
  5. Shows/hides pagination via `renderPagination()`

---

### `renderPagination(total, pages)`
- **Action:** Builds and injects the pagination control HTML (prev/next arrows + numbered pages, max 5 shown, with ellipsis). Updates the "Showing X–Y of Z" info text.

---

### `goPage(p)` (exposed as `window.goPage`)
- **Input:** `number` — target page
- **Action:** Validates bounds, sets `S.page`, calls `renderTable()`.

---

### `renderAll()`
- **Action:** Full dashboard re-render. Calls: `renderMetrics()`, `renderSummary()`, `renderCharts()`, `applyFilter()`, `renderTable()`.
- **Exposed as:** `window.renderAll` (live-prices.js calls this after mutating `S.raw`)

---

### `showLtModal(ticker)` / `hideLtModal()`
- **Action:** Show/hide the LT Analysis confirmation modal. `showLtModal()` stores the ticker in `ltPendingTicker`. The modal's Go button opens `lt-analysis.html?ticker=X` in a new tab.
- **Triggered by:** Clicking a stock slice in the pie chart (stock mode only, not 'Other')

---

### `exportDashboardPDF()`
- **Action:** Temporarily replaces the paginated table with all rows, triggers `window.print()`, then restores the table. The `pagination` element is hidden during print.

---

### `exportInfoPDF()`
- **Action:** Shows the Momentum Info overlay, adds a print-specific body class, triggers `window.print()`, then restores state.

---

### CSV Export (event listener on `#exportCSVBtn`)
- **Action:** Builds a CSV string from `S.raw` (10 columns), creates a Blob URL, triggers a download named `portfolio-YYYY-MM-DD.csv`.

---

### Keyboard Shortcuts (global `keydown`)
| Shortcut | Action |
|---|---|
| `Alt+U` | Open file picker |
| `Alt+D` | Toggle dark/light mode |
| `Alt+E` | Export CSV |
| `Alt+F` | Focus search input |
| `Escape` | Blur search input |

---

### localStorage Restore (on page load)
- **Action:** Reads `pf-data` and `pf-cash` from localStorage. If valid, rehydrates `S.raw`, `S.original`, `S.filtered`, `S.cashAmount`, calls `renderAll()`, and triggers `fetchPerfHistory()`.

---

## 4. `portfolio-performance.js` — Performance Widget

**Role:** The Performance bar chart widget. Depends on `utils.js` (FMP, keys, `fmpGet`) and `portfolio.js` (`window.S`, `window.renderBarChart`). Loaded after `portfolio.js`. **Now wrapped in an IIFE** (previously ran in the global scope) — the three functions other modules call cross-file (`showPerfPlaceholder`, `clearPerfState`, `fetchPerfHistory`) are still explicitly exposed via `window.X = X` assignments inside the IIFE, so nothing else needed to change for the wrap.

---

### `fmtMmDd(dateStr)`
- **Input:** `'YYYY-MM-DD'`
- **Output:** `'Jun-27'`
- **Used by:** `updatePerfDateRange()`

---

### `showPerfPlaceholder(show)` (exposed as `window.showPerfPlaceholder`)
- **Action:** Show/hide the overlay over the performance bar chart canvas. Shown when no data has been loaded yet.

---

### `showPerfSpinner(show)`
- **Action:** Show/hide the CSS loading spinner inside the placeholder. Shown during the `fetchPerfHistory()` fetch.

---

### `setTabsDisabled(disabled)`
- **Action:** Disables/enables all `.perf-tab` buttons and the `#perfRefreshBtn` during a fetch operation to prevent double-clicks.

---

### `setActiveTab(tabId)`
- **Action:** Adds `active` class to the matching tab button, removes from all others. Shows/hides the Custom input panel based on whether `tabId === 'Custom'`.

---

### `updatePerfDateRange(startDate, endDate)`
- **Input:** Two `'YYYY-MM-DD'` strings
- **Action:** Writes `From <strong>Jun-10</strong> (close) to <strong>Jun-27</strong> (close)` into `#perfDateRange`.

---

### `clearPerfState()` (exposed as `window.clearPerfState`)
- **Action:** Full reset of performance widget state. Called when a new CSV is uploaded or the portfolio is cleared.
  - Nulls `S.xDayOverride`, `S.perfHistoryMap`
  - Resets `S.activePerfTab` to `'1D'`
  - Shows placeholder, hides spinner
  - Resets to 1D tab, clears date range text, resets chart title

---

### `calcTabReturn(days, useCalendar)`
- **Input:** `days: number`, `useCalendar: boolean`
- **Output:** `{ returnMap: Map<ticker, returnPct>, startDate: string|null, endDate: string|null }`
- **Action:** Computes return percentages from cached `S.perfHistoryMap`.
  - **Trading day mode** (`useCalendar=false`): uses `hist[days]` directly (FMP only returns trading days)
  - **Calendar day mode** (`useCalendar=true`): finds nearest trading day to `now - days × 86400000ms`
  - Return formula: `((hist[0].close - startClose) / startClose) × 100`
  - Populates `startDate` and `endDate` from first ticker that returns valid history
- **Used by:** `renderPerfTab()`

---

### `renderPerfTab(tabId, days, useCalendar)`
- **Action:** Renders the bar chart for a fixed period tab using cached data.
  1. Calls `calcTabReturn()` to get the return map
  2. Writes to `S.xDayOverride`, `S.xDayN`, `S.xDayMode`, `S.activePerfTab`
  3. Calls `window.renderBarChart(S.raw, returnMap)`
  4. Updates date range and chart title
- **Used by:** Tab click events and `fetchPerfHistory()`

---

### `isPerfSkipped(sym)`
- **Input:** `string` — ticker symbol
- **Output:** `boolean`
- **Action:** Returns `true` if the ticker should be excluded from performance calculations.
  - `sector === 'Crypto'` (Robinhood parser tags these)
  - Regex `/USD$|-USD$|USDT$/` (generic CSV crypto notation)
- **Used by:** `fetchPerfHistory()`, `fetchXDayReturn()`

---

### `fetchPerfHistory(resetTab = true)` (exposed as `window.fetchPerfHistory`)
- **Type:** `async function`
- **Input:** `resetTab: boolean`
  - `true` → initial portfolio load, always renders 1D tab
  - `false` → Live Prices refresh, re-renders whichever tab is currently active
- **Action:**
  1. Shows spinner, disables tabs
  2. Deduplicates tickers from `S.raw`, filters via `isPerfSkipped()`
  3. Fires parallel `Promise.allSettled()` — one `fmpGet()` call per ticker (`limit=130`)
  4. Sorts each history array newest-first, stores in `S.perfHistoryMap`
  5. If `resetTab`: renders 1D tab, enables Refresh button
  6. If not `resetTab`: re-renders currently active tab (skips Custom tab)
  7. On error: shows error message in placeholder
- **API call:** `GET /stable/historical-price-eod/full?symbol={sym}&limit=130` (via `fmpGet`)

---

### `fetchXDayReturn(days)`
- **Type:** `async function`
- **Input:** `days: number` (1–365)
- **Output:** `{ returnMap: Map<ticker, returnPct>, startDate: string|null, endDate: string|null }`
- **Action:** Per-run fetch used exclusively by the Custom tab. Unlike `fetchPerfHistory()`, this re-fetches from FMP each time.
  - Computes `limit` dynamically: `Math.ceil(days × 0.75) + 10` for calendar mode, `days + 5` for trading mode
  - Same return calculation logic as `calcTabReturn()`
- **API call:** `GET /stable/historical-price-eod/full?symbol={sym}&limit={limit}` (via `fmpGet`)

---

### Tab Definitions (event-driven, configured via HTML `data-*` attrs)

| Tab | `data-days` | `data-mode` | Mode |
|---|---|---|---|
| 1D | 1 | trading | Direct array index |
| 5D | 5 | trading | Direct array index |
| 10D | 10 | trading | Direct array index |
| 15D | 15 | trading | Direct array index |
| 30D | 30 | calendar | Nearest date match |
| 60D | 60 | calendar | Nearest date match |
| 90D | 90 | calendar | Nearest date match |
| 120D | 120 | calendar | Nearest date match |
| Custom | user input | ≤10 → trading, >10 → calendar | Per-run fetch |
| Today ($) | — | — | Live-Prices-driven, not EOD history (added 2026-07-08, see below) |

---

### `renderTodayDollarTab()` (new 2026-07-08)
- **Action:** Renders the "Today ($)" tab — a bar chart of $ gain/loss per stock, driven entirely by Live Prices data, not `S.perfHistoryMap`/EOD history like every other tab in this widget.
  1. Calls `window.getTodayDollarChanges()` (§3, `portfolio.js`)
  2. If empty (Live Prices never refreshed): hides `#barChart`, shows the `#perfDollarPlaceholder` idle prompt
  3. Otherwise: builds a `Map<symbol, dollarChange>` and calls `window.renderBarChart(window.S.raw, thatMap, 'dollar')`
- **Rendered lazily on tab click only** — deliberately does *not* auto-refresh when Live Prices refreshes (unlike the Allocation widget's equivalent "Today's $" pies in `portfolio.js`, §3, which auto-refresh for free via the existing `renderAll()` chain). This was an explicit simplicity choice for the first version; flagged in `FEATURES.md` as an easy follow-up if live-push behavior is wanted later.
- **Tab-strip click handler** (`#perfTabStrip` listener) now special-cases `data-tab="TodayDollar"` before the existing `Custom`/`perfHistoryMap`-gated branches, and resets `#barChart`'s visibility + hides `#perfDollarPlaceholder` whenever a *different* tab is clicked (so leftover state from this tab doesn't bleed into the normal % tabs).
- **Porting note:** this tab has no dependency on `S.perfHistoryMap` at all — a backend port only needs whatever endpoint already backs "Live Prices" (see §5's `getQuotes`-equivalent), not a new EOD-history endpoint.

---

## 5. `live-prices.js` — Live Market Prices

**Role:** Manages the Live Market Prices section. Wrapped in an IIFE. Depends on `utils.js` (including `fmpGet`) and `portfolio.js` (`window.S`, `window.renderAll`). **`fetchQuotesFMP` now calls the shared `fmpGet()`** instead of hand-rolling its own `AbortController`/timeout/status-check chain.

---

### Module-level state
```js
liveChartInst             = null  // unused currently
lastLivePriceMap          = {}    // { [sym]: { price, changeDollar, changePercent, name } }
liveTab                   = 'top15'
lastLiveAllOthersPriceMap = {}
```

---

### `applyFMPKeyState()`
- **Action:** Shows/hides the API key setup form vs the "key saved" row. Enables/disables the Refresh button.
- **Triggered:** On module load and after any key save/change.

---

### Country/Market Selector (`initCountrySelector`)
- **Action:** Reads `pf-country` from localStorage, sets the `<select>` value, updates the badge label (`'USA'` or `'India (NSE)'`). Persists on change.

---

### `refreshLivePrices()`
- **Type:** `async function`
- **Action:** Refreshes live prices for the Top-15 holdings by value.
  1. Takes top 15 holdings from `S.raw` sorted by `currentValue`
  2. Calls `fetchQuotesFMP(symbols)` → `lastLivePriceMap`
  3. Calls `applyLivePrices(priceMap)` — mutates `S.raw`
  4. Calls `renderAll()` (re-renders all charts and table with live prices)
  5. Calls `renderLiveSummary()` and `renderTickerList(priceMap)`
  6. Shows "All Others" tab group if portfolio has >15 holdings
  7. Updates timestamp text
- **Triggered by:** Refresh button when `liveTab === 'top15'`

---

### `fetchQuotesFMP(symbols)`
- **Type:** `async function`
- **Input:** `string[]` — ticker symbols
- **Output:** `{ [sym]: { price, changeDollar, changePercent, name } }`
- **Action:**
  1. One `fmpGet()` call per symbol, all parallel (`Promise.allSettled`), with a 15-second timeout override (`{ timeoutMs: 15000 }`)
  2. `fmpGet` already resolves HTTP 402 to `null` (plan limit) — the `.then()` here just treats `null`/missing-price responses as "skip this symbol"
  3. Extracts: `price`, `change` (dollar), `changesPercentage` (percent)
  4. Derives `changePercent` from `change / prevPrice × 100` if available
  5. If the first rejected settle result's error message includes `'Invalid or expired FMP API key'`, re-throws a friendlier top-level message
- **API call:** `GET /stable/quote?symbol={sym}` (via `fmpGet`)

---

### `applyLivePrices(priceMap)`
- **Input:** `{ [sym]: { price, changeDollar, changePercent } }`
- **Action:** Mutates `S.raw` in place with live data.
  - Updates `currentPrice`, `currentValue`, `gainLoss`, `returnPct` for each matched holding
  - Recomputes `allocation` percentages for the full portfolio
  - Re-filters `S.filtered` based on current `S.query`
- **Returns:** `number` — count of holdings updated

---

### `computeGroupGain(priceMap)`
- **Input:** price map (Top-15 or All-Others subset)
- **Output:** `{ gainDollars: number, covered: holding[] }`
- **Action:** Computes today's intraday $ gain for all holdings covered by this price map.
  - `shares = currentValue / price` (derives share count from live price)
  - `gain = shares × changeDollar`
- **Used by:** `renderLiveSummary()`

---

### `resetLiveSection()`
- **Action:** Full reset of the live prices section to pre-fetch empty state.
  - Nulls `liveChartInst`, `lastLivePriceMap`, `lastLiveAllOthersPriceMap`
  - Hides ticker list, summary, status; shows empty state
  - Resets tab to Top-15, hides tab group
- **Exposed as:** `window.resetLiveSection` (called by `clearDashboard()`)

---

### `renderLiveSummary()`
- **Action:** Renders the 4 live summary cards.
  - **Live Equity Value:** `S.raw.reduce(sum currentValue)` — always correct since `S.raw` is mutated by both refresh paths
  - **Delta Change (today's $ gain):** `top15.gainDollars + others.gainDollars`. Shows breakdown subtext.
  - **Gainers/Losers:** Counts across merged `lastLivePriceMap + lastLiveAllOthersPriceMap`
  - **Today's total gain badge:** `#liveTodayGain` — dollar + percentage
- **Called by:** Both `refreshLivePrices()` and `refreshAllOthers()`

---

### `ltlColor(pct)`
- **Input:** `number` — change percent
- **Output:** CSS color string
- **Logic:** >3% → dark green; >0% → green; >-3% → light red; ≤-3% → red

---

### `renderTickerList(priceMap)`
- **Input:** price map (Top-15 data)
- **Action:** Renders the compact ticker list rows for the Top-15 view.
  - Each row: symbol, company name, live price, today's dollar/percent change, holding total value
  - Clicking a row calls `analyzeMomentum(symbol, price)`
  - Active row (last momentum analysis) gets `.ltl-active` highlight
  - If momentum data exists for the active ticker, shows a signal badge inline
- **Exposed as:** `window.renderTickerList` (momentum.js calls this to update the badge after analysis)

---

### `setLiveTab(tab)`
- **Action:** Switches the Live Prices view between Top-15 and All Others tabs. Toggles visibility of each list container.

---

### `refreshAllOthers()`
- **Type:** `async function`
- **Action:** Same flow as `refreshLivePrices()` but for holdings ranked 16+.
  - Slices `S.raw` sorted by value, takes `[15:]`
  - Calls `fetchQuotesFMP()`, stores in `lastLiveAllOthersPriceMap`
  - Calls `applyLivePrices()`, `renderAll()`, `renderAllOthersList()`, `renderLiveSummary()`
- **Triggered by:** Refresh button when `liveTab === 'others'`

---

### `renderAllOthersList(priceMap)`
- **Action:** Same as `renderTickerList()` but renders into `#liveAllOthersList` using holdings ranked 16+.

---

### `window.lastLiveAllOthersPriceMap` getter (added 2026-07-08)
- **Type:** `Object.defineProperty(window, 'lastLiveAllOthersPriceMap', { get: () => lastLiveAllOthersPriceMap })`
- **Gap found and fixed:** this module-level map (holdings ranked 16+) was only ever exposed internally — `window.lastLivePriceMap` (Top-15) already had a getter, but its All-Others counterpart didn't, making it invisible to other files. Added alongside the existing `lastLivePriceMap` getter.
- **Used by:** `portfolio.js`'s `getTodayDollarChanges()` (§3), which merges both maps.

---

## 6. `momentum.js` — Momentum Analysis Widget

**Role:** Technical indicator calculation and result rendering for the Momentum Analysis Widget. Wrapped in an IIFE. **Substantially changed this session**: standalone ticker input, Kelly sizing is now gated by momentum score (not just R:R), a "Strength List" tab sourced from Contrarian Finder scan data, 16 hover tooltips on the Analysis tab (content in `momentum-help.js`, see §7), and a Node-testability fix (DOM wiring guarded so the file can be `require()`'d).

---

### Module-level state
```js
mwLastTicker = null   // last analyzed ticker
mwLastPrice  = null   // last analyzed price
mwLastData   = null   // last computed result object
mwCapital    = 50000  // position sizing capital (persisted to localStorage)
```

---

### Math Helpers (arrays are newest-first throughout)

#### `mwSMA(a, n)`, `mwEMA(a, n)`, `mwRSI(a, n=14)`, `mwMACD(a)`, `mwBB(a, n=20)`
- Private per-widget copies of the same math now also centralized in `utils.js` (`calcSMA`/`calcRSI`/`calcBB` — see §2). These were **not** removed or refactored to call the shared versions this session; they remain independent implementations. `mwMACD` (EMA-based, no shared equivalent) is unique to this file.
- **Porting note:** When porting, use `momentum.service.js`'s ported indicator functions (based on `utils.js`'s `calcSMA`/`calcRSI`/`calcBB`) as the source of truth, plus a ported MACD implementation matching `mwMACD`'s exact EMA(12)/EMA(26)/EMA(9)-of-difference formula.

---

### `mwSetState(state, msg)`
- **Input:** `state: 'idle' | 'loading' | 'error' | 'result'`
- **Action:** Hides all 4 widget state panels, shows the target one. Sets loading text or error message.

---

### `analyzeMomentum(ticker, currentPrice)` (exposed as `window.analyzeMomentum`, guarded — see "DOM Wiring" below)
- **Type:** `async function`
- **Input:** `ticker: string`, `currentPrice: number | null` — `null` when triggered from the standalone ticker input (no click-through price available yet)
- **Action (full flow):**
  1. Validates FMP key
  2. Highlights the selected row in the live ticker list (no-op if not present, e.g. standalone input)
  3. Sets widget state to `'loading'`
  4. Fetches quote + 130-day OHLCV history from FMP in parallel via `Promise.allSettled([fmpGet(quoteUrl), fmpGet(histUrl)])` — the historical fetch is required (throws if it fails/is empty), the quote fetch is best-effort (a failure there doesn't block analysis; falls back to `currentPrice` or the latest close)
  5. Sorts history newest-first
  6. Extracts `closes[]`, `volumes[]`, `lows[]` arrays
  7. Validates minimum 30 days of data
  8. Computes all indicators:
     - `sma20 = mwSMA(closes, 20)`
     - `sma50 = mwSMA(closes, min(50, length))`
     - `rsi = mwRSI(closes, 14)`
     - `macd = mwMACD(closes)` (MACD + Signal + Hist + previous values)
     - `bb = mwBB(closes, 20)` (Upper / Mid / Lower / bandwidth)
     - `volRatio = volumes[0] / avg(volumes[0..19])`
     - `dayChg = closes[0] - closes[1]`
     - `swingLow = min(lows[0..4])`
  9. Trade setup:
     - `entryLow = price > sma20 ? sma20 : price × 0.99`
     - `entryHigh = price`
     - `entryMid = (entryLow + entryHigh) / 2`
     - `stopLoss = min(bb.lower × 0.99, swingLow × 0.99, price × 0.97)` — the **widest** (most conservative) of the 3 candidates, unlike the Contrarian Finder's Strength List estimate (§8), which intentionally uses the tightest
     - `target = bb.upper`
     - `rr = (target - entryMid) / (entryMid - stopLoss)`
  10. Component scores (0–2 each):
     - `sRSI`: 2 if RSI 55–68; 1 if RSI 45–70; 0 otherwise
     - `sMACD`: 2 if MACD > Signal AND MACD > 0; 1 if MACD > Signal OR fresh crossover; 0 otherwise
     - `sVol`: 2 if volRatio > 1.5 AND up-day; 1 if volRatio > 1; 0 otherwise
     - `sTrend`: 2 if price > SMA20 AND SMA50; 1 if price > SMA20 only; 0 otherwise
     - `sRR`: 2 if R:R ≥ 3; 1 if R:R ≥ 2; 0 otherwise
     - `total = sRSI + sMACD + sVol + sTrend + sRR` (max 10)
  11. Signal classification: 8–10 → STRONG BUY; 6–7 → BUY; 4–5 → WATCH; 0–3 → AVOID
  12. BB flags (2 shown in panel): overbought / oversold / above-mid / below-mid / squeeze / expanding
  13. Additional warnings: RSI >70, RSI <30, bearish MACD, low volume, low R:R
  14. Stores result in `mwLastData`, calls `mwRender()`
- **API calls (via `fmpGet`):** `GET /stable/quote?symbol={ticker}` and `GET /stable/historical-price-eod/full?symbol={ticker}&limit=130` — historical limit raised from 60 to 130 days this session for a cleaner MACD/EMA warm-up.

---

### `calcKellySizing(rr, capital, entryMid, score)`
- **Input:** `rr: number`, `capital: number`, `entryMid: number`, `score: number` (0–10 momentum score — **new parameter this session**)
- **Output:** `{ kF, hk, pos, sh, noEntry }`
  - `kF` = Kelly fraction: `max((0.55 × rr - 0.45) / rr, 0)`
  - `noEntry` = `score < 6` — **new**: below this threshold, no position is shown at all regardless of Kelly output, matching the `momentum-trading` skill spec
  - `hk` = Half-Kelly, gated:
    - `0` if `noEntry` or `kF <= 0`
    - `min(max(kF/2, 0.10), 0.20)` if `score >= 7` (10% floor + 20% cap)
    - `min(kF/2, 0.20)` if `score` is 6 (20% cap only, **no** 10% floor)
  - `pos` = `capital × hk` (dollar position size)
  - `sh` = `floor(pos / entryMid)` (share count), or `0` if `entryMid <= 0`
- **Assumption:** Win rate W = 0.55
- **Why the score gate was added:** previously an AVOID-tier ticker (score 1–3) could still show a confident dollar position size purely from a favorable R:R — the fix ensures position sizing respects the overall signal strength, not just one component.
- **Test coverage:** `tests/momentum.test.js` (Node's built-in `node --test`, no dependencies) covers the full gating matrix: score <6 → no position; score 6 vs 7 with identical R:R (floor absent vs present); the 20% cap applying at any qualifying score; `rr <= 0` → zero Kelly; the position-size/share-count derivation; and the `entryMid = 0` division guard.
- **Node-testability mechanism:** `momentum.js` ends with `if (typeof module !== 'undefined') module.exports = { calcKellySizing };` — a no-op in the browser (`module` is undefined there) that lets the test suite `require()` the real shipped function. This required moving all of the file's top-level DOM wiring (see below) behind a `typeof document !== 'undefined'` guard, since it previously ran unconditionally and crashed under Node.
- **Porting note:** The backend's `momentum.service.js` must replicate this exact score-gating logic, not just the raw Kelly formula — a naive port that only carries over `kF = max((0.55*rr-0.45)/rr, 0)` without the score gate would reintroduce the bug this session fixed.

---

### `buildMwResultHtml(d, sizing, cap)`
- **Input:** result data object, sizing object, capital amount
- **Output:** HTML string for the full result panel
- **Sections rendered:**
  1. Signal badge + score (N/10) + score bar + component breakdown
  2. Two-column grid: **Indicators** (RSI, MACD line, Signal/Hist, Volume ratio, SMA20, SMA50 — each with a hover tooltip) + **Bollinger Bands** (title also has a tooltip; visual track + flags)
  3. Two-column grid: **Trade Setup** (Entry zone, Stop-loss, Target, R:R, Hold period — each with a tooltip) + **Position Sizing** (Half-Kelly, capital input, Kelly%, position size, share count — each with a tooltip). When `noEntry`, this column instead shows a `.warn-box`-styled "No position" message (see §2/CSS notes below) instead of the sizing rows.
  4. Signals & Warnings section (no tooltips — general text, not a discrete term)
  5. Disclaimer
- **Visual changes this session:** the "Indicators"/"Bollinger Bands"/"Trade Setup"/"Position Sizing" block-title labels each have a distinct light pastel background (lilac/rose/peach/mint respectively, theme-aware) instead of a plain uppercase label with a bottom border. The stop-loss/target values use `.text-danger`/`.text-success` CSS classes instead of inline `style="color:..."`.
- **Tooltip mechanism:** every indicator/term label gets a `mw-tip-lbl` class + `tabindex="0"` + `data-tip="${MW_HELP.xxx}"` attribute. `.mw-tip-lbl` is a CSS-only component (dotted underline + `cursor:help`, popover via `content:attr(data-tip)` on `::after`, shown on `:hover`/`:focus`) — no separate icon element, no JS event wiring. See §7 for where the copy lives.
- **Porting note:** This whole function is presentation-only HTML string-building; the backend doesn't need an equivalent — the new frontend (Phase 3) will re-implement this as real components once a framework is chosen, but the *data* it's derived from (`mwLastData`'s shape) is exactly what `momentum.service.js` should return.

---

### `mwRender(d, cap)`
- **Action:** Injects `buildMwResultHtml()` into `#mwResult`, sets state to `'result'`. Wires up the capital input's `input` event for live position sizing recalculation (no API call) — calls `calcKellySizing(d.rr, v, d.entryMid, d.total)` with the current score each time, since the gating now depends on it.

---

### Standalone Ticker Input (new this session)
- `mwTickerInput` / `mwGoBtn` — module-level bindings (declared with `let`, assigned inside the DOM-wiring guard below) to a ticker text input + "Go" button, mirroring the Contrarian Comeback widget's input pattern.
- `mwGoAnalyze()` — reads and uppercases the input, calls `analyzeMomentum(ticker, null)` if non-empty.
- Lets a user analyze any ticker directly, not just by clicking a Live Prices row.

---

### Strength List Tab (new this session)

- `mwSetTab(tab)` — switches between the `'analysis'` and `'strength'` panes (`#mwAnalysisPane`/`#mwStrengthPane`), toggling the two tab buttons' active state. Calls `renderMwStrengthList()` when switching to Strength.
- `renderMwStrengthList()` — reads `window.cfStrengthList` (populated by `contrarian-finder.js`'s scan — see §8) and renders it as a `.cf-table`-styled table: Ticker·Company, Price, RSI, SMA20, SMA50, R:R, Kelly %, Half-Kelly %, Change, and an "Analyze →" button per row. Shows an idle message ("Run Contrarian Finder to populate this list") when the list is empty. A disclaimer line above the table reads "Estimates only — MACD & Volume aren't checked here; full analysis may differ" since the Strength List's R:R/Kelly% is a lighter-weight estimate (see §8) than the full `analyzeMomentum()` computation.
- `window.mwAnalyzeFromStrength(ticker, price)` — the "Analyze →" button's handler: switches to the Analysis tab and runs the real `analyzeMomentum()` for that ticker.
- **Why this exists:** Contrarian Finder's scan already fetches quote + historical data for ~450 stocks; this reuses that same fetch to also flag bullish "strength" candidates (RSI 55–68, above both SMA20/50, hasn't already spiked +10%) without any additional API calls, surfacing them in a dedicated tab rather than requiring a separate lookup.

---

### DOM Wiring (guarded — new mechanism this session)

Everything that touches `document`/`window` at the top level of the IIFE (element lookups, `addEventListener` calls, the `window.mwAnalyzeFromStrength` assignment, and the public API exposure below) is wrapped in:
```js
if (typeof document !== 'undefined') {
  // ... all DOM wiring ...
}
```
This is always `true` in a real browser (no behavior change there) but lets the file be safely `require()`'d in Node for the test suite (§ above), which has no `document`/`window`. Includes:
- Ticker input wiring (input/keydown/click listeners)
- Tab button wiring (`#mwTabAnalysis`/`#mwTabStrength` click → `mwSetTab`)
- Info modal wiring (`#mwInfoBtn`/`#mwInfoClose`/backdrop-click/`Escape` — unchanged behavior from before)
- The public API exposure: `window.analyzeMomentum`, and getter-based `window.mwLastTicker`/`window.mwLastData` (via `Object.defineProperty`, so `live-prices.js` always reads the current closure values, not a stale snapshot)

---

## 7. `momentum-help.js` — Tooltip Content

**Role:** New file this session. A plain top-level script (same pattern as `utils.js` — no IIFE wrapper, so its export is globally accessible) holding a single constant, loaded in `index.html` immediately before `momentum.js`.

---

### `MW_HELP`
- **Type:** constant (`object` — 16 string values, one per Analysis-tab label)
- **Keys:** `rsi`, `macd`, `signalHist`, `volume`, `sma20`, `sma50`, `bb`, `entryZone`, `stopLoss`, `target`, `rr`, `holdPeriod`, `kelly`, `halfKelly`, `posSize`, `shares`
- **Purpose:** Single source of truth for the Momentum widget's hover-tooltip copy (see §6, "Analysis tab" tooltip mechanism). `momentum.js` references these via `data-tip="${MW_HELP.rsi}"` etc. — no literal tooltip text is embedded in `momentum.js` itself.
- **Why a separate file:** keeps a meaningful amount of user-facing copy out of the render/logic file, mirroring this project's per-widget file naming convention (`momentum.js` + `momentum-help.js`, like `contrarian-finder.js` stands alone).
- **Porting note:** When the frontend is rebuilt (Phase 3), this content should move into whatever i18n/copy convention the new frontend framework uses — it's pure text content, not logic, and has no dependency on anything else in the app.

---

## 8. `contrarian-finder.js` — Contrarian Finder Scanner

**Role:** Universe assembly and multi-batch stock scanner. Wrapped in an IIFE. **Substantially changed this session**: universe assembly is now 100% static (all live constituent-list API calls removed), batch size/count are configurable with a dynamically-scaling progress bar, the inter-batch wait has a small safety buffer, and each scanned stock is additionally screened for "Strength List" candidacy (feeds `momentum.js`'s Strength List tab — see §6).

---

### Constants
| Name | Value | Purpose |
|---|---|---|
| `CF_BATCH` | 125 | Default stocks per batch (was 150 before this session) |
| `CF_WAIT` | 62 | **Real** seconds between batches — a small safety buffer against the next batch firing right at a rate-limit window edge (was 60 before this session) |
| `CF_WAIT_DISPLAY` | 60 | What the on-screen countdown/label shows ("1 minute wait", "60s → 0s remaining") — kept at 60 so the extra 2s buffer is invisible to the user |
| `CF_MAX` | 450 | Maximum universe size |
| `CF_MAX_BATCHES` | 3 | Default value for the Max Batches dropdown (dropdown itself now offers 2/3/4/5/6, was 2/3 before this session) |
| `CF_ETF_LIST` | 11 SPDR ETFs | Sector ETF constituent sources |
| `CF_STRENGTH_LOOKBACK` | 60 | Bars needed for the SMA50/RSI14 strength screen (see `cfScanStock` below) — the historical fetch limit is `max(cfScanDays+2, CF_STRENGTH_LOOKBACK)` so there's always enough history for both the decline-scan and the strength-screen |

---

### Module-level state
```js
cfQuality  = { minPrice: 10, minMarketCap: 5e9 }  // set by cfReadRunConfig() at scan-start
cfScanDays = 7                                      // set by cfReadRunConfig() at scan-start
cfRunning  = false
cfCachedAll = []   // full scan results — re-filtered without re-scanning on threshold change
```
`window.cfStrengthList` (global, new this session) — the filtered/sorted "strength" candidates published after each scan; consumed by `momentum.js`'s Strength List tab.

---

### `CF_STATIC`
- **Type:** object — the full constituent lists (no longer a "fallback" — this is now the *only* source, see below)
- **Contents:**
  - `dj30[]` — 30 Dow Jones components
  - `ndx100[]` — ~86 Nasdaq-100 components
  - `sp500[]` — ~200 S&P 500 Top components
  - `etf{}` — 11 SPDR ETFs × ~20 top holdings each

---

### `cfAssembleUniverse()` — **rewritten this session, no longer async, no live fetch**
- **Type:** plain (synchronous) function — previously `async`, since it used to attempt 14 live FMP/Finnhub API calls before falling back
- **Output:** `Array<{ symbol, tier, source }>`
- **Action:** Builds the scan universe directly from `CF_STATIC`, deduped (`seen` Set, first-seen tier wins) and capped at `CF_MAX = 450`, in priority order: DJ30 (tier 1) → NDX100 (tier 2) → S&P 500 (tier 3) → each of 11 sector ETFs (tier 4).
- **Why the live-fetch path was removed:** Confirmed via live console errors that FMP's `dowjones-constituent`/`nasdaq-constituent`/`sp500-constituent` (HTTP 402) and `/v3/etf-holder/{ETF}` (HTTP 403) all require a paid plan tier beyond what's active. Also tested Finnhub's equivalent `index/constituents` and `etf/holdings` endpoints (via a test harness added to `dev/test-fmp-api.html`) — same result, 403 on the free tier. Since neither provider works without a paid upgrade, and both always fell through to `CF_STATIC` anyway, the ~14 guaranteed-to-fail calls per scan were pure wasted latency and have been removed entirely.
- **`cfFetch()` — deleted.** The old fetch wrapper used by this function (and by `cfScanStock`, see below) never threw, always returning `{ok, status, data?}` — it's gone; `cfScanStock` now uses the shared `fmpGet()` from `utils.js` directly.
- **Porting note:** `CF_STATIC` (~450 tickers) is already ported to the backend as `cf_static_universe.js` per the sister repo's Phase 1 scaffolding — confirm it matches this frozen version. The backend does **not** need to replicate the abandoned live-constituent-fetch code path; it was dead weight in the source app too, just not yet deleted when the backend was first scaffolded.

---

### `cfScanStock(sym, key)` — **extended this session with a strength screen**
- **Type:** `async function`
- **Output:** Result object with: `symbol`, `name`, `sector`, `price`, `mktCap`, `volume`, `avgVol`, `changePct`, `mktClosed`, `filterFail`, `noData`, **`strength`** (new — `null`, or an enrichment object, see below)
- **Action:** Scans one stock via two parallel `fmpGet()` calls (was `cfFetch()` calls before this session):
  1. `GET /stable/quote?symbol={sym}` — for price, marketCap, volume, avgVolume
  2. `GET /stable/historical-price-eod/full?symbol={sym}&limit={max(cfScanDays+2, CF_STRENGTH_LOOKBACK)}` — for price history (limit raised to also cover the strength screen's SMA50/RSI14 needs)
- **Quality filter:** Returns `{ filterFail: true }` if price < `cfQuality.minPrice` or mktCap < `cfQuality.minMarketCap`
- **Change calculation:**
  - Market closed: `endPrice = hist[0].close`, `startClose = hist[cfScanDays].close`
  - Market open: `endPrice = current price`, `startClose = hist[cfScanDays-1].close`
  - `changePct = (endPrice - startClose) / startClose × 100`
- **Strength screen (new):** If ≥50 closes are available, computes `sma20`/`sma50` (via `calcSMA` from `utils.js`) and `rsi` (via `calcRSI`). If RSI is 55–68 **and** price is above both SMAs **and** `changePct < 10` (hasn't already spiked), computes an *estimated* R:R and Kelly%:
  - `bb = calcBB(closes, 20)`, `swingLow = min(lowest 5 lows)` (or `price*0.97` if <5 lows available)
  - `entryLow = price > sma20 ? sma20 : price*0.99`, `entryMid = (entryLow + price) / 2`
  - `stopLoss`: the **tightest** of 3 candidates (`Math.max(bb.lower*0.99, swingLow*0.99, price*0.97)`), floored at `entryMid * 0.98` — deliberately the *opposite* choice from `momentum.js`'s real per-ticker analysis (which uses the widest/`Math.min`), so this pre-screen estimate reads as more optimistic rather than flatlining at 0% for every candidate. The `entryMid`-relative floor exists because of a discovered edge case: when a ticker's price sits ~6.3% above its SMA20, the naive tightest-stop formula can collapse the risk distance toward zero (an absurd R:R like 113:1), independent of actual volatility — root-caused with real VLO/TMO data mid-session.
  - `target = bb.upper`, `rr = (target - entryMid) / (entryMid - stopLoss)` (0 if the denominator is ≤ 0.01)
  - `kF = max((0.55*rr - 0.45)/rr, 0)`, `halfKelly = min(kF/2, 0.20)` — **no** score-based gating here (unlike `momentum.js`'s `calcKellySizing`), since this pre-screen has no MACD/Volume components to compute a full 0–10 score
  - Result: `strength = { rsi, sma20, sma50, rr, kF, halfKelly }`
- **Porting note:** The `momentum.service.js` backend port should expose this same strength-screen logic as a distinct function (not bundled into the main decline-scan), since the two "R:R" computations in this app (Momentum's conservative widest-stop vs. this file's optimistic tightest-stop pre-screen) are *intentionally different formulas answering different questions* — a backend port must preserve that distinction rather than unifying them into one "true" R:R.

---

### `cfMiniSetState(barIdx, state, pct)`
- **Action:** Updates a single mini progress bar element by index. States: `'idle'`, `'wip'` (animated), `'done'` (full green).
- **Bar index mapping:** Batch N → bar `N*2-1`, Wait N → bar `N*2` (generalizes to any batch count via `cfBuildMiniRow`, see below — no longer a fixed 5-bar mapping).

---

### `cfOrdinal(n)` — **new this session**
- **Input:** `number`
- **Output:** `string` — e.g. `1` → `'1st'`, `2` → `'2nd'`, `5` → `'5th'`
- **Purpose:** Generalizes the countdown's "Nth minute wait" label beyond the old hardcoded "1st"/"2nd" pair, now that up to 5 waits can occur (6 batches → 5 inter-batch waits).

---

### `cfBuildMiniRow(maxBatches)` — **new this session, replaces a fixed 5-segment layout**
- **Input:** `number` (2–6) — the configured Max Batches value
- **Action:** Dynamically builds `2×maxBatches−1` progress-bar segments (alternating Batch/Wait), batch segments at `flex:0.33` and wait segments at `flex:0.25` so flexbox naturally scales each segment's width down as more batches are added.
- **Why:** The progress row used to be hardcoded to exactly 5 segments (`#cfMF1`–`#cfMF5`, covering Batch1/Wait1/Batch2/Wait2/Batch3) — it only ever worked correctly for the old 2/3-batch options. Now that Max Batches goes up to 6, the row is rebuilt at the start of every scan (`cfRun()` calls this after reading the configured `maxBatches`).

---

### `cfStatSet(univMsg, batchMsg, candsMsg, candsGreen)`
- **Action:** Updates the 3 stat text elements (`#cfStatUniv`, `#cfStatBatch`, `#cfStatCands`). Pass `undefined` to skip updating a slot. `candsGreen` colors the candidates count green.

---

### `cfSetProgress(batchNum, done, total, cands)`
- **Action:** Updates the progress bar for a running batch and the batch/candidates stat text.

---

### `cfRunCountdown(nextBatchNum)` — **timing changed this session**
- **Type:** `async function` (returns a Promise)
- **Action:** Runs the real `CF_WAIT` (62s) countdown between batches, but all on-screen text/percentage uses `CF_WAIT_DISPLAY` (60) — the displayed "remaining" seconds is `Math.max(CF_WAIT_DISPLAY - elapsed, 0)`, so it holds at "0s remaining" for the final ~2 real seconds while the actual timer finishes underneath. Updates the wait bar and stat text every second. Resolves when the real 62s elapses.

---

### `cfScanBatch(stocks, batchNum, totalBatches, key)`
- **Type:** `async function`
- **Input:** `stocks: { symbol, source }[]`, batch metadata, FMP key
- **Output:** scan result array
- **Action:** Scans all stocks in a batch via `Promise.allSettled()` (all parallel). Calls `cfScanStock()` per stock. Updates progress bar and stat text as results come in. Marks batch bar as done when complete.

---

### `cfRenderResults(threshold)`
- **Input:** `threshold: number` — decline % threshold (e.g. 25)
- **Action:** Filters `cfCachedAll` to candidates with `changePct <= -threshold`, sorts by largest decline first, renders an HTML table.
- **Table columns:** Ticker + Company, Sector, N-Day Change, Price, Market Cap, Volume/Avg ratio, Found-In index
- **Action buttons per row:** `Contra →` opens `contrarian-analysis.html`, `Long` opens `lt-analysis.html`
- **Color-coded change cells:** ≥-35% darkest red; ≥-25%; ≥-20%; ≥-15%
- The candidate-count header (`"N stocks declined ≥X% in Y days"`) now uses the `.text-success` CSS class instead of an inline `style="color:var(--success)"`.

---

### `cfOpenAnalysis(ticker)` / `cfOpenLtAnalysis(ticker)` (exposed on `window`)
- **Action:** Opens `contrarian-analysis.html?ticker=X&country=Y&source=finder` or `lt-analysis.html?ticker=X` in a new tab.

---

### `cfRefilter()`
- **Action:** Re-applies the threshold filter to `cfCachedAll` without re-fetching. Called when the threshold dropdown changes.

---

### `cfReadRunConfig()`
- **Output:** `{ batchSize, maxBatches, qualityPreset, qLabel }`
- **Action:** Reads the Advanced panel inputs at scan-start. Sets global `cfScanDays` and `cfQuality`.
  - `qualityPreset === 'relaxed'`: `{ minPrice: 5, minMarketCap: 2.5e9 }`
  - `qualityPreset === 'standard'`: `{ minPrice: 10, minMarketCap: 5e9 }`
- **Batch size dropdown:** now 50/100/125 (was 50/100/125/150/200 — trimmed this session). **Max Batches dropdown:** now 2/3/4/5/6 (was 2/3 — expanded this session).

---

### `cfRunAllBatches(batches, key)`
- **Type:** `async function`
- **Action:** Runs batches sequentially: scan batch → countdown → scan batch → countdown → … Returns merged results array.

---

### `cfRun()` (main entry point) — **now also publishes the Strength List**
- **Type:** `async function`
- **Action:** Full scan orchestration.
  1. Guard: if already running or no FMP key, exit
  2. Resets `window.cfStrengthList = []`
  3. Reads config via `cfReadRunConfig()`
  4. Resets UI (hides idle state, shows mini progress row)
  5. Calls `cfBuildMiniRow(maxBatches)` to size the progress row for however many batches this run uses (**new** — replaces the old fixed 5-bar reset)
  6. Calls `cfAssembleUniverse()` (now synchronous, static-only) to build the stock list
  7. Slices universe to `batchSize × maxBatches`, splits into batch arrays
  8. Calls `cfRunAllBatches()` → stores in `cfCachedAll`
  9. **New:** publishes `window.cfStrengthList` — filters `cfCachedAll` to entries with a non-null `strength`, maps to `{ symbol, name, sector, price, changePct, ...strength }`, sorted by `kF` descending
  10. Calls `cfRenderResults(threshold)` to display the final decline-candidates table
  11. Updates final stat text with scan summary
  12. Re-enables Run button

---

## 9. `stock-preview-chart.js` — Stock Preview Chart

**Role:** Reusable 90-day price + % return chart component with period return pills. Wrapped in an IIFE. Exposes two global functions. Unchanged since the last porting pass.

---

### Module-level state
```js
_charts = {}  // keyed by containerId — Chart.js instances
```

---

### `spcFetch(url)`
- **Action:** Fetch wrapper that returns `null` on any error (never throws). **Not** migrated to `fmpGet` this session — this file intentionally keeps its own never-throw contract, distinct from `fmpGet`'s throw-on-error contract, since callers here just want "data or nothing" without a try/catch.

---

### `spcFmtPct(v)`
- **Output:** Integer percentage with sign (e.g. `'+12%'`). Used in pills.

### `spcFmtPctFull(v)`
- **Output:** One-decimal percentage with sign (e.g. `'+12.3%'`). Used in header and tooltips.

---

### `pillHtml(label, pct, forceGreen, forceRed)`
- **Input:** label string, percentage value, optional color overrides
- **Output:** HTML string for one return period pill
- **Color logic:** Positive → green; negative → red; `forceGreen`/`forceRed` override
- **Used by:** `renderStockPreviewChart()` to build the pill row

---

### `computeReturns(data, currentPx, marketOpen)`
- **Input:** FMP EOD history (newest-first), current price, market open flag
- **Output:** `{ today, prev, d5, d10, d15, d30, d60, d90 }` — all as percentage returns
- **Logic:**
  - **Market open:** All returns use `currentPx` as the end price; start is `hist[N].close`
  - **Market closed:** All returns use `hist[0].close` as end; start is `hist[N+1].close`

---

### `renderStockPreviewChart(ticker, containerId)` (exposed as `window.renderStockPreviewChart`)
- **Type:** `async function`
- **Input:** `ticker: string`, `containerId: string` — DOM element ID
- **Action:**
  1. Shows loading spinner
  2. Parallel fetch: `GET /stable/quote` + `GET /stable/historical-price-eod/full?limit=96` (via `spcFetch`)
  3. Validates: needs `quote.price` and at least 20 history rows
  4. Uses `quote.isActivelyTrading` to determine market open (reliable across timezones)
  5. Builds price series: 90 trading days oldest-first, appends live price if market open
  6. Builds % series: `(currentPx - hist[i].close) / hist[i].close × 100` — anchored at current price
  7. Computes X-axis labels: finds nearest trading day to 30D/60D/90D/120D calendar targets via `calDayIdx()`; labels last point as `'O'` (open) or `'C'` (closed), second-to-last as `'Prev'`
  8. Calls `computeReturns()` and builds pill row HTML
  9. Renders Chart.js dual-axis chart: left Y-axis for price ($), right Y-axis for % return
  10. Stores Chart.js instance in `_charts[containerId]`

---

### `destroyStockPreviewChart(containerId)` (exposed as `window.destroyStockPreviewChart`)
- **Action:** Destroys the Chart.js instance for a container and clears its DOM content.

---

## 10. `app.js` — Entry Point & Wiring

**Role:** Top-level wiring for the Contrarian Comeback widget and Finnhub key management. **Now wrapped in an IIFE** (previously ran in the global scope, with `_ccInput`/`_ccBtn`/`_ccLongBtn` as true globals). Confirmed via grep that nothing outside this file calls its functions or references its variables, and no inline HTML `onclick` attributes reference them — the wrap needed zero additional `window.X` exposures.

---

### Contrarian Comeback Widget

#### `ccLoadChart()`
- **Action:** Reads the ticker input (`#contrarianInput`), calls `renderStockPreviewChart(ticker, 'spcContainer')`.
- **Triggered by:** Enter key on the ticker input.

#### Input event on `#contrarianInput`
- **Action:** Enables/disables the `Go` and `Long` buttons based on whether input is non-empty. Calls `destroyStockPreviewChart('spcContainer')` when input is cleared.

#### Click on `#contrarianBtn` (Go)
- **Action:** Opens `contrarian-analysis.html?ticker={T}&country={country}` in a new tab.

#### Click on `#contrarianLongBtn` (Long)
- **Action:** Opens `lt-analysis.html?ticker={T}` in a new tab.

---

### Finnhub Key Management (Contrarian Comeback widget)

#### `applyCCFinnhubKeyState()`
- **Action:** Shows/hides the Finnhub key setup form vs the "key saved" state based on `getFinnhubKey()`.

#### `#ccFhSaveBtn` click
- **Action:** Reads `#ccFhKeyInput`, calls `setFinnhubKey()`, clears input, calls `applyCCFinnhubKeyState()`.

#### `#ccFhChangeBtn` click
- **Action:** Calls `setFinnhubKey('')` to clear the key, re-shows setup form.

---

## Cross-Module Public API Summary

| Symbol | Exposed by | Consumed by |
|---|---|---|
| `window.S` | `portfolio.js` | `live-prices.js`, `portfolio-performance.js`, `momentum.js` |
| `window.renderAll` | `portfolio.js` | `live-prices.js` (after mutating S.raw) |
| `window.renderBarChart` | `portfolio.js` | `portfolio-performance.js` |
| `window.goPage` | `portfolio.js` | Inline pagination `onclick` handlers |
| `window.showPerfPlaceholder` | `portfolio-performance.js` | `portfolio.js` (renderCharts) |
| `window.clearPerfState` | `portfolio-performance.js` | `portfolio.js` (loadData, clearDashboard) |
| `window.fetchPerfHistory` | `portfolio-performance.js` | `portfolio.js` (loadData, localStorage restore) |
| `window.resetLiveSection` | `live-prices.js` | `portfolio.js` (clearDashboard) |
| `window.renderTickerList` | `live-prices.js` | `momentum.js` (after analysis, to update badge) |
| `window.getPortfolioCountry` | `live-prices.js` | `app.js`, `contrarian-finder.js` |
| `window.lastLivePriceMap` | `live-prices.js` (getter) | `portfolio.js` (theme re-render, `getTodayDollarChanges`), `momentum.js` |
| `window.lastLiveAllOthersPriceMap` | `live-prices.js` (getter) | `portfolio.js`'s `getTodayDollarChanges` *(new 2026-07-08 — gap fix, see §5)* |
| `window.getTodayDollarChanges` | `portfolio.js` | `portfolio-performance.js`'s `renderTodayDollarTab()` *(new 2026-07-08)* |
| `window.mwLastTicker` | `momentum.js` (getter) | `live-prices.js` (badge highlight) |
| `window.mwLastData` | `momentum.js` (getter) | `live-prices.js` (badge data) |
| `window.analyzeMomentum` | `momentum.js` | `live-prices.js` (row click handler) |
| `window.mwAnalyzeFromStrength` | `momentum.js` | Inline `onclick` in the Strength List table's "Analyze →" button *(new this session)* |
| `window.cfStrengthList` | `contrarian-finder.js` | `momentum.js` (Strength List tab) *(new this session)* |
| `window.cfOpenAnalysis` | `contrarian-finder.js` | Inline `onclick` in CF results table |
| `window.cfOpenLtAnalysis` | `contrarian-finder.js` | Inline `onclick` in CF results table |
| `window.renderStockPreviewChart` | `stock-preview-chart.js` | `app.js` |
| `window.destroyStockPreviewChart` | `stock-preview-chart.js` | `app.js` |
| `MW_HELP` | `momentum-help.js` (plain global, not `window.`-prefixed) | `momentum.js` (tooltip copy) *(new this session)* |

---

## API Calls Summary

| Module | Endpoint | Method | Purpose |
|---|---|---|---|
| `live-prices.js` | `/stable/quote?symbol={sym}` | GET × N (parallel, via `fmpGet`) | Live price + today's change per ticker |
| `portfolio-performance.js` | `/stable/historical-price-eod/full?symbol={sym}&limit=130` | GET × N (parallel, via `fmpGet`) | 130-day EOD history per ticker (cached) |
| `portfolio-performance.js` | `/stable/historical-price-eod/full?symbol={sym}&limit={limit}` | GET × N (parallel, via `fmpGet`) | Custom-tab per-run fetch |
| `momentum.js` | `/stable/quote?symbol={ticker}` | GET × 1 (via `fmpGet`) | Live quote for the analyzed ticker |
| `momentum.js` | `/stable/historical-price-eod/full?symbol={ticker}&limit=130` | GET × 1 (via `fmpGet`) | 130-day OHLCV for indicator calculation (raised from 60 days this session) |
| `contrarian-finder.js` | `/stable/quote?symbol={sym}` | GET × N (parallel, via `fmpGet`) | Quote per scanned stock |
| `contrarian-finder.js` | `/stable/historical-price-eod/full?symbol={sym}&limit={N}` | GET × N (parallel, via `fmpGet`) | EOD history per scanned stock (limit now also covers the strength screen's needs) |
| `stock-preview-chart.js` | `/stable/quote?symbol={ticker}` | GET × 1 (via `spcFetch`) | Current price + market status |
| `stock-preview-chart.js` | `/stable/historical-price-eod/full?symbol={ticker}&limit=96` | GET × 1 (via `spcFetch`) | 90-day chart data |

**Removed this session** — `contrarian-finder.js` no longer calls any of the following (all required a paid FMP/Finnhub plan tier beyond what's active, confirmed via live 402/403 responses, and always fell through to the static `CF_STATIC` lists anyway):
- `/stable/dowjones-constituent`
- `/stable/nasdaq-constituent`
- `/stable/sp500-constituent`
- `/v3/etf-holder/{ETF}` (× 11)
- Finnhub's `index/constituents` and `etf/holdings` (never used in production — only tested via `dev/test-fmp-api.html`, confirmed 403 on the free tier)

**Porting note:** The backend does not need proxy endpoints for any of the removed calls above — they're dead weight in the source app and shouldn't be replicated. Every remaining call in this table routes through `fmpGet` (or `spcFetch` for the one holdout), which is the exact status-code handling (§2) the backend's own FMP proxy service should replicate for parity.
