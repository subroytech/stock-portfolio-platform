// Ported from CreateStockPortfolioViewWOSkill/js/momentum.js — pure math only.
// analyzeMomentum()/mwRender()/buildMwResultHtml() (fetch orchestration + HTML
// rendering) are intentionally NOT ported; a future controller will call
// marketData.service.ts for history and these functions for the math, and
// return JSON instead of an HTML string.

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
