import type { CandlestickInterval } from '../api/candlestick';

// The 9 possible chart overlays/panels - every one of these is pure math already sitting in the
// fetched candlestick snapshot, no network call, so toggling any on/off is instant. RSI/MACD are
// oscillators (a different value scale than price) so they render as their own stacked panel,
// never overlaid on the candlesticks - everything else overlays directly (see
// CandlestickPopup.tsx's PriceChart/VolumeChart).
export type IndicatorKey = 'ma' | 'bb' | 'vwap' | 'pivotPoints' | 'fibonacci' | 'rsi' | 'macd' | 'volumeMa' | 'obv';

export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  ma: 'Moving Averages', bb: 'Bollinger Bands', vwap: 'VWAP', pivotPoints: 'Pivot Points', fibonacci: 'Fibonacci', rsi: 'RSI', macd: 'MACD',
  volumeMa: 'Volume MA', obv: 'OBV',
};

// The three trading horizons CandlestickQuickReference.tsx teaches - which timeframe belongs to
// which horizon is a fixed domain fact (independent of the indicator-relevance content itself).
export type HorizonId = 'dayTrading' | 'mediumTerm' | 'longTerm';

export const INTERVAL_HORIZON: Record<CandlestickInterval, HorizonId> = {
  '5min': 'dayTrading', '15min': 'dayTrading',
  '30min': 'mediumTerm', '1hour': 'mediumTerm', '4hour': 'mediumTerm',
  '1day': 'longTerm',
};

interface HorizonSection {
  id: HorizonId;
  title: string;
  timeframes: string;
  core: { key: IndicatorKey; why: string }[];
  skip: string;
}

// The authoritative "what's relevant when" data, rendered by CandlestickQuickReference.tsx's
// "Core Indicators" lists and consumed by CandlestickPopup.tsx (via HORIZON_INDICATORS/
// HORIZON_TITLES below, both derived from this same array) to decide which indicator-toggle
// buttons to show for the currently-selected timeframe - a real usability gap this closes: every
// one of the 9 toggles used to show regardless of timeframe, making it easy to turn on an
// indicator that's actively misleading at that horizon (e.g. VWAP on a 1-Day chart). Living here
// (not in the component file) rather than as a component-local const is what lets both
// CandlestickQuickReference.tsx (the display) and CandlestickPopup.tsx (the filtering) import the
// exact same data without either one re-deriving or hand-copying the other's list.
export const HORIZONS: HorizonSection[] = [
  {
    id: 'dayTrading',
    title: 'Day Trading',
    timeframes: '5 Min (~3 days) · 15 Min (~9 days)',
    core: [
      { key: 'vwap', why: "the intraday fair-value anchor — price above it is a bullish bias for the session, below is bearish." },
      { key: 'volumeMa', why: 'confirms a move has real participation behind it, not just a few thin prints.' },
      { key: 'pivotPoints', why: "classic intraday support/resistance levels, calculated off the prior session's high/low/close." },
      { key: 'rsi', why: 'fast overbought/oversold read for timing entries against a pivot level.' },
      { key: 'bb', why: 'a band squeeze often precedes a sharp intraday move; riding a band shows strong momentum.' },
      { key: 'macd', why: 'quick momentum/crossover confirmation on 5-15 min bars.' },
    ],
    skip: 'Fibonacci, OBV, and the longer Moving Averages (SMA50) - all too slow to matter within a single session.',
  },
  {
    id: 'mediumTerm',
    title: 'Medium-Term (Swing)',
    timeframes: '30 Min – 4 Hour (~17-112 days)',
    core: [
      { key: 'ma', why: 'the trend backbone — price vs. SMA20/SMA50, and which is above the other, sets the swing direction.' },
      { key: 'macd', why: 'the classic swing-trading crossover signal on 1-4 hour bars.' },
      { key: 'rsi', why: 'spot pullback entries (dipping to 30-40 in an uptrend) or exhaustion warnings above 70.' },
      { key: 'fibonacci', why: 'the standard swing tool — 38.2%/61.8% retracement zones after a clear swing high/low.' },
      { key: 'obv', why: 'confirms the move with volume — rising OBV alongside rising price is healthy; a divergence is a warning.' },
      { key: 'bb', why: 'gauges whether you\'d be chasing an already-extended move.' },
    ],
    skip: 'VWAP and Pivot Points - both are single-session concepts that stop meaning anything once a chart spans weeks.',
  },
  {
    id: 'longTerm',
    title: 'Long-Term (Position)',
    timeframes: '1 Day (~224 days)',
    core: [
      { key: 'ma', why: 'the primary trend filter — many long-term holders won\'t add to a position trading below its SMA50.' },
      { key: 'macd', why: 'flags major trend inflection points over months, filtered from day-to-day noise.' },
      { key: 'obv', why: 'the most long-term-relevant indicator here — sustained accumulation/distribution over months.' },
      { key: 'volumeMa', why: 'whether overall interest in the stock is growing or fading over time.' },
      { key: 'fibonacci', why: 'identifies whether a pullback is a healthy correction or a broken trend structure.' },
    ],
    skip: 'VWAP, Pivot Points, and to a large extent RSI/Bollinger Bands - an "overbought" RSI can persist for months in a real uptrend and isn\'t itself a sell signal.',
  },
];

export const HORIZON_INDICATORS: Record<HorizonId, IndicatorKey[]> = HORIZONS.reduce(
  (acc, h) => { acc[h.id] = h.core.map((c) => c.key); return acc; },
  {} as Record<HorizonId, IndicatorKey[]>,
);

// The header's small "Showing indicators for {horizon}" caption reuses this tab's own horizon
// names, so the two surfaces always agree on what to call each timeframe grouping.
export const HORIZON_TITLES: Record<HorizonId, string> = HORIZONS.reduce(
  (acc, h) => { acc[h.id] = h.title; return acc; },
  {} as Record<HorizonId, string>,
);
