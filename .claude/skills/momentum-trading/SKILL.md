---
name: momentum-trading
description: >
  Short-term momentum trading analysis for US equity markets (NYSE/NASDAQ). Use this skill
  whenever the user wants to analyze stocks for swing trading, momentum signals, entry/exit points,
  stop-loss levels, position sizing, portfolio tracking, or trade recommendations for 2-30 day
  delivery-based holdings (no options or futures). Trigger on phrases like: "analyze this stock",
  "should I buy X", "momentum scan", "swing trade", "trade setup", "portfolio performance",
  "position sizing", "stop loss", "entry point", "exit point", "momentum score", "compare stocks",
  or when a user uploads CSV/spreadsheet data with OHLCV price history. Also trigger when the user
  mentions tickers, asks about P&L, or wants to review their current holdings. Never skip this skill
  when trading analysis is involved — even casual questions like "is AAPL looking good?" benefit
  from this structured approach.
---

# Momentum Trading Skill

Short-term swing trading analysis for US equities (NYSE/NASDAQ). Delivery-based only — no options
or futures. Holding period focus: **5–15 days** (range: 2–30 days).

---

## Core Philosophy

- **Momentum first**: Only trade in the direction of the dominant trend
- **Risk before reward**: Define stop-loss before sizing a position
- **Kelly sizing**: Use fractional Kelly to determine position size based on win rate and payoff
- **Signal confluence**: Require at least 2 of 3 indicators (RSI + MACD + Volume) to agree before scoring above 6/10

---

## Input Modes

### Mode A: Ticker Symbol(s)
User provides one or more tickers (e.g., `AAPL`, `NVDA, TSLA, META`). Fetch or ask for recent
OHLCV data (at minimum 60 trading days). If web search is available, retrieve current price,
volume, and recent trend context. If not, ask the user to paste or upload recent data.

### Mode B: Uploaded CSV / Spreadsheet
Read the uploaded file per the `file-reading` skill. Expected columns (flexible):
`Date, Open, High, Low, Close, Volume` — adapt to whatever columns are present.
If data is insufficient (<20 rows), warn the user and proceed with caveats.

### Mode C: Portfolio File
User uploads a file with current holdings. Expected columns:
`Ticker, Entry Price, Shares, Entry Date` — calculate unrealized P&L, days held, and evaluate
each position for exit signals.

---

## Analysis Pipeline

Run this pipeline for each stock being analyzed:

### Step 1 — Data Validation
- Confirm sufficient history (≥ 20 bars minimum, 60 bars ideal)
- Check for data gaps, splits, or anomalies
- Note the market cap tier (Large/Mid/Small) if determinable

### Step 2 — Momentum Indicators

#### RSI (14-period)
- **Bullish**: RSI 50–70 (trending up with room to run)
- **Overbought warning**: RSI > 75 (reduce score)
- **Bearish**: RSI < 50
- **Oversold bounce setup**: RSI 28–35 (potential reversal, flag separately)

#### MACD (12, 26, 9)
- **Bullish signal**: MACD line crosses above signal line + histogram turning positive
- **Strong bull**: Both MACD and signal line above zero
- **Bearish**: MACD below signal line or histogram turning negative
- Note divergences (price making new highs but MACD declining = red flag)

#### Volume Analysis
- Compare last 3–5 bars' volume to 20-day average volume
- **Bullish confirmation**: Price up + volume > 1.5× average
- **Bearish warning**: Price up + volume below average (weak move)
- **Climax volume**: Extreme spike (>3× avg) — possible reversal, flag it
- Track On-Balance Volume (OBV) trend direction

### Step 3 — Support & Resistance
- Identify key support levels from recent swing lows (last 20–40 bars)
- Identify key resistance levels from recent swing highs
- Note any round numbers, prior breakout levels, or gap fills
- These levels drive stop-loss placement (see Step 5)

### Step 4 — Momentum Score (1–10)

Score the stock based on indicator confluence:

| Component | Max Points | Criteria |
|-----------|-----------|---------|
| RSI strength | 2 | 1pt if RSI 45–70; 2pts if RSI 55–68 (ideal range) |
| MACD signal | 2 | 1pt if bullish crossover; 2pts if crossover + above zero |
| Volume confirmation | 2 | 1pt if recent vol > avg; 2pts if breakout vol on up-move |
| Trend alignment | 2 | 1pt if above 20-day SMA; 2pts if above both 20 & 50-day SMA |
| Risk/reward setup | 2 | 1pt if R:R ≥ 2:1; 2pts if R:R ≥ 3:1 |

**Score Interpretation:**
- **8–10**: 🟢 **Strong Buy** — High-conviction momentum trade
- **6–7**: 🟡 **Buy** — Good setup, acceptable risk/reward
- **4–5**: 🟠 **Watch** — Mixed signals, wait for clarity
- **1–3**: 🔴 **Avoid** — Weak or conflicting momentum

### Step 5 — Entry, Stop-Loss & Target

#### Entry Price
- Ideal entry: On a pullback to support or EMA, not chasing extended moves
- Note if current price is >5% above the nearest support (extended risk)
- Provide a **limit entry zone** (e.g., "entry between $X and $Y")

#### Stop-Loss (Support/Resistance based)
- Place stop **just below the nearest significant support level** (1–2% buffer)
- For longs: below the most recent swing low or key support
- Never risk more than 8% below entry on any single trade
- If the natural support stop exceeds 8%, reduce position size or skip trade

#### Price Target
- Target the next significant resistance level
- Minimum acceptable R:R ratio: **2:1** (target = entry + 2× risk)
- Preferred R:R: **3:1 or better**
- Note the expected holding period (5–15 days typical)

### Step 6 — Position Sizing (Kelly Criterion)

Use fractional Kelly (half-Kelly for aggressive profile) to size positions:

```
Kelly % = W - [(1 - W) / R]
Half-Kelly % = Kelly % / 2

Where:
  W = estimated win rate (use 0.55 as default if no track record)
  R = reward-to-risk ratio (target gain / stop-loss distance)

Position $ = Total Capital × Half-Kelly %
Shares = Position $ / Entry Price
```

**Aggressive profile constraints (10–20% capital per trade):**
- If Half-Kelly < 10%: override to 10% minimum if score ≥ 7
- If Half-Kelly > 20%: cap at 20% maximum
- If score < 6: do not enter regardless of Kelly output
- Maximum simultaneous positions: 5–6 (to stay within 100% capital)

---

## Output Format

### Single Stock Analysis
```
═══════════════════════════════════════════
  MOMENTUM ANALYSIS: [TICKER] — [DATE]
═══════════════════════════════════════════
Current Price: $XXX.XX
Signal: 🟢 STRONG BUY / 🟡 BUY / 🟠 WATCH / 🔴 AVOID
Momentum Score: X/10

INDICATORS
  RSI (14):     XX.X  → [Bullish/Neutral/Bearish]
  MACD:         [Signal description + histogram direction]
  Volume:       XX% vs 20-day avg → [Confirming/Weak/Warning]

TRADE SETUP
  Entry Zone:   $XX.XX – $XX.XX
  Stop-Loss:    $XX.XX  (X.X% below entry | Support: [level description])
  Target:       $XX.XX  (X.X% gain | Resistance: [level description])
  R:R Ratio:    X.X : 1
  Hold Period:  X–X days

POSITION SIZING (Capital: $X,XXX,XXX)
  Kelly %:      XX.X%  →  Half-Kelly: XX.X%
  Capped at:    XX%  (aggressive profile)
  Position $:   $XX,XXX
  Shares:       XXX shares

NOTES
  • [Any warnings: overbought, low volume, divergence, etc.]
  • [Catalyst or risk events if known]
═══════════════════════════════════════════
```

### Multi-Stock Comparison Table
When comparing 3+ stocks, lead with a ranked summary table:

| Rank | Ticker | Score | Signal | Entry | Stop | Target | R:R | Kelly% |
|------|--------|-------|--------|-------|------|--------|-----|--------|
| 1    | XXXX   | X/10  | 🟢     | $XXX  | $XXX | $XXX   | X:1 | XX%    |

Follow with full individual analyses for the top-ranked stocks.

### Portfolio Review
For each position in the portfolio:

| Ticker | Entry | Current | P&L% | Days | Score | Action |
|--------|-------|---------|------|------|-------|--------|
| XXXX   | $XXX  | $XXX    | +X%  | X    | X/10  | Hold / Exit / Tighten Stop |

---

## Risk Management Rules

Always surface these rules when providing trade recommendations:

1. **Never risk more than 8% on a single trade** (hard stop distance)
2. **Max 20% capital in one position** (Kelly cap)
3. **Max 5–6 open positions** at aggressive sizing
4. **Exit rules**: Exit if (a) stop hit, (b) momentum score drops to ≤3, (c) 15-day holding limit reached with target not hit, or (d) major adverse news
5. **Scaling out**: For score 8–10 trades, consider taking 50% profit at 1.5× risk and letting the rest run to target
6. **No averaging down**: If price hits stop-loss, exit fully — do not add to losing positions

---

## Common User Scenarios

| User says... | Action |
|---|---|
| "Analyze NVDA" | Run full pipeline for NVDA ticker |
| "Compare AAPL, MSFT, GOOGL" | Run pipeline for all three, produce ranked comparison table |
| "Here's my portfolio CSV" | Run portfolio review mode, flag exits and holds |
| "Should I buy or sell TSLA?" | Full analysis + explicit buy/sell recommendation with reasoning |
| "My capital is $50,000" | Use that figure for all Kelly/position sizing calculations |
| "I'm up 12% on AMD, should I hold?" | Check current momentum score; recommend hold/partial exit/full exit |
| Upload of OHLCV data | Parse with file-reading skill, run full pipeline on the data |

---

## Important Disclaimers

Always include this note when providing trade recommendations:

> ⚠️ *This analysis is for informational purposes only and does not constitute financial advice.
> All trading involves risk. Past momentum patterns do not guarantee future performance.
> Always do your own research before making investment decisions.*

---

## Reference Files

- `references/indicators.md` — Detailed calculation formulas for RSI, MACD, OBV, SMA/EMA
- `references/kelly-examples.md` — Kelly Criterion worked examples with edge cases
- `references/support-resistance.md` — Guide to identifying S/R levels from price data
