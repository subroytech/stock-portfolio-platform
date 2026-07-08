// Ported from CreateStockPortfolioViewWOSkill/js/momentum.js — pure math only.
// analyzeMomentum()/mwRender()/buildMwResultHtml() (fetch orchestration + HTML
// rendering) are intentionally NOT ported; a future controller will call
// marketData.service.js for history and these functions for the math, and
// return JSON instead of an HTML string.

// Arrays are newest-first unless noted.

function mwSMA(a, n) {
  return a.slice(0, n).reduce((s, v) => s + v, 0) / n;
}

function mwEMA(a, n) {
  const p = [...a].reverse(); // oldest -> newest for calculation
  const k = 2 / (n + 1);
  let e = p.slice(0, n).reduce((s, v) => s + v, 0) / n; // SMA seed
  const o = [e];
  for (let i = n; i < p.length; i++) { e = p[i] * k + e * (1 - k); o.push(e); }
  return o.reverse(); // back to newest-first
}

function mwRSI(a, n = 14) {
  const p = [...a].reverse(); // oldest -> newest
  const ch = [];
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

function mwMACD(a) {
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

function mwBB(a, n = 20) {
  const sl = a.slice(0, n);
  const mid = sl.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sl.reduce((s, v) => s + (v - mid) ** 2, 0) / n);
  return { upper: mid + 2 * sd, mid, lower: mid - 2 * sd, bw: mid > 0 ? 4 * sd / mid : 0 };
}

// Half-Kelly position sizing. Gated by momentum score: score <6 -> no entry
// regardless of Kelly output; the 10% floor only applies when score >=7
// (per momentum-trading skill spec).
function calcKellySizing(rr, capital, entryMid, score) {
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

module.exports = { mwSMA, mwEMA, mwRSI, mwMACD, mwBB, calcKellySizing };
