// New technical indicators for the Stock Analysis candlestick feature - VWAP, Pivot Points
// (Classic), and Fibonacci Retracement don't exist anywhere else in this codebase (confirmed via
// a repo-wide search before building this). Same newest-first CandlestickBar[] convention as the
// raw bars stored in m_stock_ticker_candlestick_cache and returned by FMP's historical-chart
// endpoint.
//
// SMA/EMA/RSI/Bollinger Bands/MACD are NOT reused as-is from momentum.service.ts here, despite
// existing there - mwSMA/mwRSI/mwBB/mwMACD each return only a single current-value snapshot (the
// Momentum feature's own use case: "what's AAPL's RSI right now"), not a value at every bar,
// which is what a chart overlay/line needs. mwEMA is the one exception - it already returns a
// full series. computeSmaSeries/computeBbSeries below are correct via simple rolling-window
// reuse of mwSMA/mwBB (each reading depends only on its own trailing window, no state carried
// across bars) - genuine reuse, just called once per bar instead of once. RSI and MACD are NOT
// safe to compute that way: Wilder's RSI smoothing and MACD's EMAs both carry state forward
// continuously from the start of the series, so independently reseeding mwRSI/mwMACD at every
// window position would silently diverge from a textbook-correct continuous reading - both get
// their own real series implementation below instead (computeMacdSeries still built from mwEMA's
// own already-continuous-state output, so it's not duplicating that part of the math either).

import { mwSMA, mwBB, mwEMA, type BollingerBands } from './momentum.service';

export interface CandlestickBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Cumulative volume-weighted average price, accumulating from the oldest bar in the window
// forward - the standard definition (VWAP resets at the start of whatever window it's computed
// over; here, the full returned bar series). Returned newest-first, same convention as
// mwEMA/mwSMA elsewhere in this codebase.
export function computeVWAP(bars: CandlestickBar[]): number[] {
  const oldestFirst = [...bars].reverse();
  let cumulativeTpv = 0; // sum of typicalPrice * volume
  let cumulativeVolume = 0;
  const vwap: number[] = [];
  for (const bar of oldestFirst) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativeTpv += typicalPrice * bar.volume;
    cumulativeVolume += bar.volume;
    vwap.push(cumulativeVolume > 0 ? cumulativeTpv / cumulativeVolume : typicalPrice);
  }
  return vwap.reverse();
}

export interface PivotPoints {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

// Classic pivot points, derived from the most recently CLOSED prior bar (bars[1] - bars[0] is
// the latest/current bar, newest-first) - a handful of static support/resistance lines drawn
// across the whole chart, not a per-bar series, same as every charting platform's own
// presentation of pivot points.
export function computePivotPoints(bars: CandlestickBar[]): PivotPoints | null {
  if (bars.length < 2) return null;
  const prior = bars[1];
  const pp = (prior.high + prior.low + prior.close) / 3;
  const range = prior.high - prior.low;
  return {
    pp,
    r1: 2 * pp - prior.low,
    s1: 2 * pp - prior.high,
    r2: pp + range,
    s2: pp - range,
    r3: prior.high + 2 * (pp - prior.low),
    s3: prior.low - 2 * (prior.high - pp),
  };
}

export interface FibonacciRetracement {
  swingHigh: number;
  swingLow: number;
  // Whichever swing point happened LATER chronologically is the one being retraced from - 'up'
  // means the low came after the high (a downtrend swing; levels measure a potential upward
  // bounce off the low), 'down' means the high came after the low (an uptrend swing; levels
  // measure a potential pullback down from the high).
  direction: 'up' | 'down';
  levels: { pct: number; price: number }[];
}

const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];

// Auto-detects the swing high/low across the entire returned bar window (no user-selected anchor
// points in v1) and computes the standard retracement levels between them.
export function computeFibonacciRetracement(bars: CandlestickBar[]): FibonacciRetracement | null {
  if (bars.length < 2) return null;
  const oldestFirst = [...bars].reverse();
  let highIdx = 0;
  let lowIdx = 0;
  for (let i = 1; i < oldestFirst.length; i++) {
    if (oldestFirst[i].high > oldestFirst[highIdx].high) highIdx = i;
    if (oldestFirst[i].low < oldestFirst[lowIdx].low) lowIdx = i;
  }
  const swingHigh = oldestFirst[highIdx].high;
  const swingLow = oldestFirst[lowIdx].low;
  const range = swingHigh - swingLow;
  const direction: 'up' | 'down' = lowIdx > highIdx ? 'up' : 'down';
  const levels = FIB_LEVELS.map((pct) => ({
    pct,
    price: direction === 'down' ? swingHigh - range * pct : swingLow + range * pct,
  }));
  return { swingHigh, swingLow, direction, levels };
}

// Rolling-window reuse of mwSMA - each bar's reading only depends on its own trailing `period`
// closes, so recomputing per-bar is both simple and exactly correct (no state to carry across
// bars, unlike RSI/MACD below). null until `period` closes are available. closes must be
// newest-first (mwSMA's own convention); returned newest-first.
export function computeSmaSeries(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => (closes.length - i >= period ? mwSMA(closes.slice(i), period) : null));
}

// Same rolling-window reuse as computeSmaSeries, for mwBB.
export function computeBbSeries(closes: number[], period: number): (BollingerBands | null)[] {
  return closes.map((_, i) => (closes.length - i >= period ? mwBB(closes.slice(i), period) : null));
}

// Wilder RSI, continuous-state across the whole series - unlike momentum.service.ts's mwRSI
// (which only ever returns the final value), this keeps every intermediate reading as the
// smoothing walks forward, so it stays a genuinely correct continuous RSI rather than an
// independently-reseeded approximation at each point. closes newest-first in, series
// newest-first out (verified in tests to agree with mwRSI's own single-point result at the
// newest bar).
export function computeRsiSeries(closes: number[], period = 14): (number | null)[] {
  const oldestFirst = [...closes].reverse();
  const changes: number[] = [];
  for (let i = 1; i < oldestFirst.length; i++) changes.push(oldestFirst[i] - oldestFirst[i - 1]);

  if (changes.length < period) {
    return new Array(oldestFirst.length).fill(null); // not enough history for even one reading
  }

  const series: (number | null)[] = new Array(period).fill(null); // bar[0..period-1] - no seed yet
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) { avgGain += Math.max(changes[i], 0); avgLoss += Math.max(-changes[i], 0); }
  avgGain /= period;
  avgLoss /= period;
  series.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)); // bar[period]

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
    series.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return series.reverse();
}

export interface MacdPoint {
  macd: number;
  signal: number;
  hist: number;
}

// Built from mwEMA's own full-series output (already continuous/state-correct) for the 12- and
// 26-period EMAs, exactly matching mwMACD's formula - just keeping every point along the way
// instead of only the newest one. closes newest-first in, series newest-first out (verified in
// tests to agree with mwMACD's own single-point result at the newest bar).
export function computeMacdSeries(closes: number[]): (MacdPoint | null)[] {
  const e12 = mwEMA(closes, 12);
  const e26 = mwEMA(closes, 26);
  const len = Math.min(e12.length, e26.length);
  const macdLine = e12.slice(0, len).map((v, i) => v - e26[i]);
  const signalLine = mwEMA(macdLine, 9);
  const points: MacdPoint[] = signalLine.map((signal, i) => ({ macd: macdLine[i], signal, hist: macdLine[i] - signal }));
  const padding: null[] = new Array(closes.length - points.length).fill(null);
  return [...points, ...padding];
}
