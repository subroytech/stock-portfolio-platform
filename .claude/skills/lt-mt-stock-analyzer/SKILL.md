---
name: lt-mt-stock-analyzer
description: >
  Medium-to-long term stock analysis skill for US equities (NYSE/NASDAQ). Use this skill
  whenever the user wants to analyze a stock for holding periods of 12 months or longer,
  research a company's investment outlook, review quarterly earnings in depth, or compare
  a company's performance against its industry peers. Trigger on phrases like: "analyze
  [TICKER] for the long term", "what's the outlook for [TICKER]", "is [TICKER] a good
  long-term hold", "medium term view on [TICKER]", "compare [TICKER] to its peers",
  "quarterly results for [TICKER]", "should I hold [TICKER]", "long term thesis for
  [TICKER]", "deep dive on [TICKER]", or any request involving investment research,
  analyst commentary, sector comparison, or valuation for a US stock. Always use this
  skill when the user asks for more than a quick price check — even casual questions like
  "is [TICKER] worth holding?" benefit from this structured approach.
---
 
# Long-to-Medium Term Stock Analyzer
 
Comprehensive investment research skill for US equities. Covers quarterly earnings,
analyst commentary, industry benchmarking, and MT/LT outlook ratings.
 
**Time horizon definitions (always apply these):**
- **Medium Term (MT):** 12–18 months
- **Long Term (LT):** 3 years and beyond
---
 
## Inputs
 
- **Required:** Stock ticker symbol (e.g. AAPL, NVDA, MSFT)
- **Optional:** User-specified focus area (e.g. "focus on valuation" or "I care most about LT")
If the user provides only a company name, resolve the ticker before proceeding.
 
---
 
## Workflow
 
Execute all research steps before writing the report. Use `web_search` and `web_fetch`
throughout. Prioritize **Yahoo Finance**, **Finviz**, and reputable financial news sources
(Reuters, Bloomberg, WSJ, Barron's, Seeking Alpha, CNBC).
 
### Step 1 — Company Snapshot
Search: `{TICKER} stock overview site:finance.yahoo.com`
Fetch Yahoo Finance summary page: `https://finance.yahoo.com/quote/{TICKER}/`
 
Capture:
- Company name, sector, industry, market cap
- Current price, 52-week range
- P/E ratio (TTM), Forward P/E, EV/EBITDA
- Beta, dividend yield (if any)
### Step 2 — Latest Quarterly Earnings
Search: `{TICKER} latest quarterly earnings results {current_year}`
Also search: `{TICKER} earnings call highlights {current_quarter} {current_year}`
 
Capture:
- Most recent quarter (e.g. Q1 FY2026)
- Revenue: actual vs. consensus estimate, YoY growth %
- EPS (adjusted): actual vs. estimate, YoY growth %
- Gross margin, operating margin (current vs. prior year)
- Management guidance for next quarter / full year
- Key themes from earnings call (growth drivers, headwinds, strategic priorities)
### Step 3 — Medium & Long Term Analyst Commentary
Search: `{TICKER} analyst price target 12 month outlook {current_year}`
Search: `{TICKER} long term investment thesis {current_year}`
Search: `{TICKER} stock forecast 2026 2027 2028`
 
Capture:
- Consensus analyst rating (% Buy / Hold / Sell)
- Average 12-month price target and range (low / mean / high)
- Key bull case arguments (MT and LT)
- Key bear case arguments / risks
- Any notable recent rating changes (upgrades/downgrades)
### Step 4 — Industry & Peer Comparison
Search: `{TICKER} vs peers valuation comparison {sector}`
Search: `{SECTOR} industry average P/E EV/EBITDA revenue growth {current_year}`
Fetch Finviz: `https://finviz.com/quote.ashx?t={TICKER}` for quick peer stats
 
Identify 3–5 direct competitors or sector peers. For each peer and for the sector average, capture:
- Revenue growth (YoY %)
- EPS growth (YoY %)
- P/E ratio (TTM and Forward)
- EV/EBITDA
- Analyst consensus (Buy % if available)
Compare the subject company against peers and sector averages. Note whether the company
is trading at a premium, discount, or in line with peers — and whether that premium/
discount is justified.
 
### Step 5 — Key Risk Factors
Search: `{TICKER} risks headwinds 2025 2026`
 
Identify 3–5 sector-specific and company-specific risks relevant to MT/LT horizons.
Examples: competitive disruption, regulatory risk, margin pressure, macro sensitivity,
balance sheet concerns, customer concentration.
 
---
 
## Output Format
 
Adapt the output based on context:
- If the user asks a casual question ("is AAPL a good long-term hold?") → use the
  **Concise Summary** format below
- If the user asks for a "deep dive", "full analysis", or "report" → use the
  **Full Structured Report** format below
- Default (no format specified) → use the **Full Structured Report**
---
 
### Format A: Full Structured Report
 
```
# {COMPANY NAME} ({TICKER}) — MT/LT Investment Analysis
*As of {DATE} | Sector: {SECTOR} | Industry: {INDUSTRY}*
 
---
 
## 1. Company Snapshot
[Market cap, price, 52-week range, P/E, Forward P/E, EV/EBITDA, Beta, Dividend]
 
---
 
## 2. Latest Quarterly Results — {QUARTER} {YEAR}
| Metric         | Actual   | Estimate | YoY Δ   |
|----------------|----------|----------|---------|
| Revenue        | $X.XB    | $X.XB    | +X.X%   |
| EPS (adj.)     | $X.XX    | $X.XX    | +X.X%   |
| Gross Margin   | XX.X%    | —        | ±X.Xpp  |
| Op. Margin     | XX.X%    | —        | ±X.Xpp  |
 
**Guidance:** [Next quarter / FY guidance summary]
**Earnings Call Themes:** [2–3 key strategic points from management]
 
---
 
## 3. Analyst Commentary & Outlook
**Consensus Rating:** X% Buy / X% Hold / X% Sell  
**12-Month Price Target:** $XX (Low: $XX | Mean: $XX | High: $XX)  
**Current Price vs. Target:** X% upside / downside
 
**Bull Case (MT: 12–18 months)**
- [Point 1]
- [Point 2]
- [Point 3]
 
**Bull Case (LT: 3+ years)**
- [Point 1]
- [Point 2]
 
**Bear Case / Risks**
- [Point 1]
- [Point 2]
 
**Notable Rating Changes:** [Any recent upgrades/downgrades]
 
---
 
## 4. Industry & Peer Comparison
| Company     | Rev Growth | EPS Growth | P/E (TTM) | Fwd P/E | EV/EBITDA | Consensus |
|-------------|------------|------------|-----------|---------|-----------|-----------|
| {TICKER} ★  | X.X%       | X.X%       | XX.Xx     | XX.Xx   | XX.Xx     | X% Buy    |
| Peer 1      | X.X%       | X.X%       | XX.Xx     | XX.Xx   | XX.Xx     | X% Buy    |
| Peer 2      | X.X%       | X.X%       | XX.Xx     | XX.Xx   | XX.Xx     | X% Buy    |
| Sector Avg  | X.X%       | X.X%       | XX.Xx     | XX.Xx   | XX.Xx     | —         |
 
**Relative Positioning:** [1–2 sentences on premium/discount vs. peers and whether justified]
 
---
 
## 5. Key Risk Factors
1. **[Risk Name]:** [Brief explanation, MT/LT relevance]
2. **[Risk Name]:** [Brief explanation, MT/LT relevance]
3. **[Risk Name]:** [Brief explanation, MT/LT relevance]
 
---
 
## 6. MT/LT Conviction Rating
 
| Horizon              | Rating              | Rationale                        |
|----------------------|---------------------|----------------------------------|
| Medium Term (12–18M) | 🟢 Bullish / 🟡 Neutral / 🔴 Bearish | [1-line summary] |
| Long Term (3Y+)      | 🟢 Bullish / 🟡 Neutral / 🔴 Bearish | [1-line summary] |
 
> ⚠️ *This rating is AI-generated based on publicly available data and analyst commentary.
> It is not financial advice. Always do your own due diligence before investing.*
```
 
---
 
### Format B: Concise Summary
 
```
## {TICKER} — Quick MT/LT Take
 
**Latest Quarter:** [1-sentence result summary]
**Analyst Consensus:** X% Buy | Avg PT: $XX (+X% upside)
**vs. Peers:** [Trading at premium/discount, one sentence]
**Top Risk:** [Single biggest risk]
 
**MT (12–18M):** 🟢/🟡/🔴 [2–3 sentence view]
**LT (3Y+):** 🟢/🟡/🔴 [2–3 sentence view]
 
> ⚠️ AI-generated analysis. Not financial advice.
```
 
---
 
## Conviction Rating Criteria
 
Use the following framework to assign MT and LT ratings independently:
 
### 🟢 Bullish
- Earnings beat + positive guidance OR strong multi-year growth runway
- Trading at or below peer valuations with stronger fundamentals
- Analyst consensus ≥ 65% Buy
- Clear competitive moat or structural tailwind for the time horizon
### 🟡 Neutral
- Mixed earnings signals or inline results with uncertain guidance
- Valuation in line with peers, no clear catalyst
- Analyst consensus 40–65% Buy
- Risks and opportunities roughly balanced
### 🔴 Bearish
- Earnings miss, guidance cut, or deteriorating margins
- Trading at significant premium to peers without fundamental justification
- Analyst consensus < 40% Buy or meaningful recent downgrades
- Identifiable structural headwind for the time horizon
**Important:** MT and LT ratings can differ. A stock may be 🔴 Bearish MT (e.g. near-term
earnings pressure) but 🟢 Bullish LT (e.g. strong secular tailwind). Always explain the
divergence if ratings differ.
 
---
 
## Data Quality & Fallbacks
 
- If Yahoo Finance or Finviz fetch fails, fall back to web search for the same data points.
- If peer valuation data is unavailable, note "data unavailable" in the table rather than omitting the row.
- If analyst consensus data is sparse, note "limited coverage" and weight the rating accordingly.
- Always cite the source and approximate date for each major data point used.
- Flag any data older than 90 days as potentially stale.
---
 
## Tone & Style
 
- Professional but accessible — write for an informed retail investor, not a Wall Street analyst
- Be direct: state what the data shows, don't hedge everything into meaninglessness
- Distinguish clearly between MT and LT views throughout
- When analyst opinions are split, represent both sides fairly
- Never fabricate numbers — if data is unavailable, say so explicitly
 