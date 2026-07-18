// Ported from CreateStockPortfolioViewWOSkill/js/momentum.js — pure math only.
// mwRender()/buildMwResultHtml() (DOM rendering) are intentionally NOT
// ported — momentum.controller.ts (2026-07-13) calls marketData.service.ts
// for history/quote and assembleMomentumAnalysis() below for the math, and
// returns JSON instead of an HTML string.

// Arrays are newest-first unless noted.

export function mwSMA(a: number[], n: number): number {
  return a.slice(0, n).reduce((s, v) => s + v, 0) / n;
}

export function mwEMA(a: number[], n: number): number[] {
  const p = [...a].reverse(); // oldest -> newest for calculation
  const k = 2 / (n + 1);
  let e = p.slice(0, n).reduce((s, v) => s + v, 0) / n; // SMA seed
  const o = [e];
  for (let i = n; i < p.length; i++) { e = p[i] * k + e * (1 - k); o.push(e); }
  return o.reverse(); // back to newest-first
}

export function mwRSI(a: number[], n = 14): number {
  const p = [...a].reverse(); // oldest -> newest
  const ch: number[] = [];
  for (let i = 1; i < p.length; i++) ch.push(p[i] - p[i - 1]);
  let ag = 0;
  let al = 0;
  for (let i = 0; i < n; i++) { ag += Math.max(ch[i], 0); al += Math.max(-ch[i], 0); }
  ag /= n; al /= n;
  for (let i = n; i < ch.length; i++) {
    ag = (ag * (n - 1) + Math.max(ch[i], 0)) / n;
    al = (al * (n - 1) + Math.max(-ch[i], 0)) / n;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export interface MacdResult {
  macd: number;
  signal: number;
  hist: number;
  prevMacd: number;
  prevSig: number;
}

export function mwMACD(a: number[]): MacdResult {
  const e12 = mwEMA(a, 12);
  const e26 = mwEMA(a, 26);
  const len = Math.min(e12.length, e26.length);
  const ml = e12.slice(0, len).map((v, i) => v - e26[i]);
  const sig = mwEMA(ml, 9);
  return {
    macd: ml[0], signal: sig[0], hist: ml[0] - sig[0],
    prevMacd: ml[1] ?? ml[0], prevSig: sig[1] ?? sig[0],
  };
}

export interface BollingerBands {
  upper: number;
  mid: number;
  lower: number;
  bw: number;
}

export function mwBB(a: number[], n = 20): BollingerBands {
  const sl = a.slice(0, n);
  const mid = sl.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / n);
  return { upper: mid + 2 * sd, mid, lower: mid - 2 * sd, bw: mid > 0 ? 4 * sd / mid : 0 };
}

export interface KellySizing {
  kF: number;
  hk: number;
  pos: number;
  sh: number;
  noEntry: boolean;
}

// Half-Kelly position sizing. Gated by momentum score: score <6 -> no entry
// regardless of Kelly output; the 10% floor only applies when score >=7
// (per momentum-trading skill spec).
export function calcKellySizing(rr: number, capital: number, entryMid: number, score: number): KellySizing {
  const kF = rr > 0 ? Math.max((0.55 * rr - 0.45) / rr, 0) : 0;
  const noEntry = score < 6;
  let hk = 0;
  if (!noEntry && kF > 0) {
    hk = score >= 7 ? Math.min(Math.max(kF / 2, 0.10), 0.20)
      : Math.min(kF / 2, 0.20);
  }
  const pos = capital * hk;
  const sh = entryMid > 0 ? Math.floor(pos / entryMid) : 0;
  return { kF, hk, pos, sh, noEntry };
}

export interface MomentumScoreBreakdown {
  rsi: number;
  macd: number;
  volume: number;
  trend: number;
  riskReward: number;
  total: number;
}

export type MomentumSignal = 'STRONG BUY' | 'BUY' | 'WATCH' | 'AVOID';

export interface MomentumAnalysis {
  price: number;
  sma20: number;
  sma50: number;
  rsi: number;
  macd: MacdResult;
  bb: BollingerBands;
  volRatio: number;
  dayChg: number;
  score: MomentumScoreBreakdown;
  signal: MomentumSignal;
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  target: number;
  rr: number;
  flags: string[];
  extras: string[];
}

// Everything below mwBB/calcKellySizing in the source app's analyzeMomentum()
// (js/momentum.js:111-168) that ISN'T presentational (sigCls/sigColor/emoji
// are CSS-only, deliberately dropped — the frontend maps `signal` to its own
// styling). `closes`/`lows`/`volumes` are newest-first, same convention as
// every other function in this file. `capital`-based Kelly sizing is
// deliberately NOT included here — calcKellySizing() stays a separate call
// the frontend makes client-side, since capital is a live-editable UI input.
export function assembleMomentumAnalysis(closes: number[], lows: number[], volumes: number[], price: number): MomentumAnalysis {
  const sma20 = mwSMA(closes, 20);
  const sma50 = mwSMA(closes, Math.min(50, closes.length));
  const rsi = mwRSI(closes, 14);
  const macd = mwMACD(closes);
  const bb = mwBB(closes, 20);
  const volN = Math.min(20, volumes.length);
  const volAvg = volN > 0 ? volumes.slice(0, volN).reduce((a, b) => a + b, 0) / volN : 0;
  const volRatio = volAvg > 0 ? volumes[0] / volAvg : 1;
  const dayChg = closes.length > 1 ? closes[0] - closes[1] : 0;
  const swingLow = lows.length >= 5 ? Math.min(...lows.slice(0, 5)) : price * 0.97;

  const entryLow = price > sma20 ? sma20 : price * 0.99;
  const entryHigh = price;
  const entryMid = (entryLow + entryHigh) / 2;
  const stopLoss = Math.min(bb.lower * 0.99, swingLow * 0.99, price * 0.97);
  const target = bb.upper;
  const rr = (entryMid - stopLoss) > 0.01 ? (target - entryMid) / (entryMid - stopLoss) : 0;

  const sRSI = rsi >= 55 && rsi <= 68 ? 2 : rsi >= 45 && rsi <= 70 ? 1 : 0;
  const cross = macd.macd > macd.signal && macd.prevMacd <= macd.prevSig;
  const sMACD = macd.macd > macd.signal && macd.macd > 0 ? 2
    : macd.macd > macd.signal || cross ? 1 : 0;
  const sVol = volRatio > 1.5 && dayChg > 0 ? 2 : volRatio > 1 ? 1 : 0;
  const sTrend = price > sma20 && price > sma50 ? 2 : price > sma20 ? 1 : 0;
  const sRR = rr >= 3 ? 2 : rr >= 2 ? 1 : 0;
  const total = sRSI + sMACD + sVol + sTrend + sRR;

  const signal: MomentumSignal = total >= 8 ? 'STRONG BUY' : total >= 6 ? 'BUY' : total >= 4 ? 'WATCH' : 'AVOID';

  const flags: string[] = [];
  if (price > bb.upper) flags.push('Overbought — price extended above upper Bollinger Band');
  else if (price < bb.lower) flags.push('Oversold — price below lower BB, potential bounce');
  else if (price > bb.mid) flags.push('Above mid-band — room to upper band target');
  else flags.push('Below mid-band — wait for price to reclaim mid-band');
  if (bb.bw < 0.05) flags.push('BB squeeze — bands contracting, breakout may be imminent');
  else if (bb.bw > 0.15) flags.push('Bands expanding — elevated volatility, wider swings likely');

  const extras: string[] = [];
  if (rsi > 70) extras.push('RSI overbought — consider waiting for a pullback before entry');
  if (rsi < 30) extras.push('RSI oversold — mean-reversion bounce opportunity');
  if (macd.macd <= macd.signal) extras.push('MACD bearish — no bullish momentum crossover yet');
  if (volRatio < 0.8) extras.push('Below-average volume — low-conviction signal');
  if (rr < 1.5 && rr > 0) extras.push('Low R:R ratio — risk/reward setup is unfavorable');

  return {
    price, sma20, sma50, rsi, macd, bb, volRatio, dayChg,
    score: { rsi: sRSI, macd: sMACD, volume: sVol, trend: sTrend, riskReward: sRR, total },
    signal, entryLow, entryHigh, entryMid, stopLoss, target, rr, flags, extras,
  };
}
