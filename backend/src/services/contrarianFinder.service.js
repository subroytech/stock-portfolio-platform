// Ported from CreateStockPortfolioViewWOSkill/js/contrarian-finder.js —
// universe assembly + per-stock scan logic is pure/portable; the fetch
// wrapper is refactored to call FMP via env-configured base URLs instead of
// the browser fetch + localStorage key, and all UI orchestration (progress
// bars, cfRun's DOM wiring) is dropped — the backend now rate-limits itself
// against FMP server-side instead of driving a visual countdown.
//
// Synced 2026-07-08 against the source app's post-fix state: universe
// assembly is static-only (the live FMP constituent/etf-holder endpoints all
// require a paid plan tier beyond what's active — confirmed 402/403 on every
// call, and they always fell through to CF_STATIC anyway), the scan window is
// configurable instead of a hardcoded 5 trading days, and each scanned stock
// is additionally screened for "Strength List" candidacy.
//
// Universe assembly moved off the CF_STATIC JS module onto the
// index_master/index_constituent DB tables on 2026-07-10 (seeded one-time
// from db/seed/cf_static_universe.js via seedTickerData.js) — same static
// data, now queryable/editable without a code deploy.

const env = require('../config/env');
const { pool } = require('../db/pool');
const { fmpGet } = require('./marketData.service');
const { mwSMA, mwRSI, mwBB } = require('./momentum.service');

const CF_ETF_LIST = ['XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLB', 'XLU', 'XLRE'];
const CF_BATCH = 125;
const CF_WAIT_SECONDS = 62; // real wait between batches - small buffer to avoid overlap
const CF_MAX = 450;
const CF_MAX_BATCHES = 3;
const CF_STRENGTH_LOOKBACK = 60; // bars needed for SMA50/RSI14 strength screen

async function fetchConstituents(indexId) {
  const { rows } = await pool.query('SELECT symbol FROM m_index_constituent WHERE index_id = $1', [indexId]);
  return rows.map((r) => r.symbol);
}

// Built from index_master/index_constituent — see header note above for why
// the live FMP constituent-fetch path was removed rather than kept as a
// primary attempt with a fallback.
async function assembleUniverse() {
  const seen = new Set();
  const universe = [];
  const add = (sym, tier, source) => {
    const s = sym?.toString().toUpperCase().trim();
    if (!s || s.length > 7 || seen.has(s) || universe.length >= CF_MAX) return;
    seen.add(s);
    universe.push({ symbol: s, tier, source });
  };

  (await fetchConstituents('DJ30')).forEach((s) => add(s, 1, 'DJ30'));
  (await fetchConstituents('NDX100')).forEach((s) => add(s, 2, 'NDX100'));
  (await fetchConstituents('SP500')).forEach((s) => add(s, 3, 'S&P 500'));
  for (const etf of CF_ETF_LIST) {
    if (universe.length >= CF_MAX) break;
    (await fetchConstituents(etf)).forEach((s) => add(s, 4, etf));
  }

  return universe;
}

async function scanStock(sym, key, quality, scanDays = 7) {
  const limit = Math.max(scanDays + 2, CF_STRENGTH_LOOKBACK);
  const [qr, hr] = await Promise.allSettled([
    fmpGet(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${key}`),
    fmpGet(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${sym}&limit=${limit}&apikey=${key}`),
  ]);

  const q = (qr.status === 'fulfilled' && qr.value) ? (Array.isArray(qr.value) ? qr.value[0] : qr.value) : null;
  const hist = (hr.status === 'fulfilled' && hr.value) ? (Array.isArray(hr.value) ? hr.value : (hr.value?.historical || [])) : [];

  const price = q?.price ?? null;
  const mktCap = q?.marketCap ?? null;

  const filterFail = (!price || price < quality.minPrice) || (!mktCap || mktCap < quality.minMarketCap);
  if (filterFail) return { symbol: sym, filterFail: true };

  if (hist.length < scanDays + 1) return { symbol: sym, filterFail: false, noData: true };

  const today = new Date().toISOString().slice(0, 10);
  const mktClosed = hist[0]?.date === today;
  const endPrice = mktClosed ? hist[0].close : price;
  const startClose = mktClosed ? hist[scanDays].close : hist[scanDays - 1]?.close;

  if (!endPrice || !startClose || startClose === 0) return { symbol: sym, filterFail: false, noData: true };

  const changePct = (endPrice - startClose) / startClose * 100;

  // Bullish "strength" screen - RSI ideal zone + above both SMAs + hasn't already spiked.
  let strength = null;
  const closes = hist.map((h) => parseFloat(h.close)).filter((v) => !Number.isNaN(v));
  const lows = hist.map((h) => parseFloat(h.low)).filter((v) => !Number.isNaN(v));
  if (closes.length >= 50) {
    const sma20 = mwSMA(closes, 20);
    const sma50 = mwSMA(closes, 50);
    const rsi = mwRSI(closes, 14);
    if (rsi >= 55 && rsi <= 68 && price > sma20 && price > sma50 && changePct < 10) {
      // Estimated R:R/Kelly% - entry/target formulas match the Momentum service.
      // Stop-loss prefers the TIGHTEST of the three candidates (Math.max, not
      // Math.min like the real per-ticker analysis) so R:R stays meaningful
      // for mild "hasn't spiked yet" pullbacks instead of reading 0% across
      // the board, floored relative to entryMid to avoid a near-zero-
      // denominator blowup (root-caused on real VLO/TMO data in the source app).
      const bb = mwBB(closes, 20);
      const swingLow = lows.length >= 5 ? Math.min(...lows.slice(0, 5)) : price * 0.97;
      const entryLow = price > sma20 ? sma20 : price * 0.99;
      const entryMid = (entryLow + price) / 2;
      const tightStop = Math.max(bb.lower * 0.99, swingLow * 0.99, price * 0.97);
      const minRiskFloor = entryMid * 0.98;
      const stopLoss = Math.min(tightStop, minRiskFloor);
      const target = bb.upper;
      const rr = (entryMid - stopLoss) > 0.01 ? (target - entryMid) / (entryMid - stopLoss) : 0;
      const kF = rr > 0 ? Math.max((0.55 * rr - 0.45) / rr, 0) : 0;
      const halfKelly = kF > 0 ? Math.min(kF / 2, 0.20) : 0;
      strength = { rsi, sma20, sma50, rr, kF, halfKelly };
    }
  }

  return {
    symbol: sym,
    name: q?.name || '',
    sector: q?.sector || '',
    price,
    mktCap,
    volume: q?.volume ?? null,
    avgVol: q?.avgVolume ?? null,
    changePct,
    mktClosed,
    filterFail: false,
    noData: false,
    strength,
  };
}

function buildBatches(universe, batchSize, maxBatches) {
  const toScan = universe.slice(0, batchSize * maxBatches);
  const batches = [];
  for (let i = 0; i < maxBatches; i++) {
    const slice = toScan.slice(i * batchSize, (i + 1) * batchSize);
    if (slice.length > 0) batches.push(slice);
  }
  return batches;
}

async function scanBatch(stocks, key, quality, scanDays) {
  const settled = await Promise.allSettled(stocks.map(async (stock) => {
    const r = await scanStock(stock.symbol, key, quality, scanDays);
    r.source = stock.source;
    return r;
  }));
  return settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { symbol: stocks[i].symbol, filterFail: true, error: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveQuality(qualityPreset) {
  return qualityPreset === 'relaxed' ? { minPrice: 5, minMarketCap: 2.5e9 } : { minPrice: 10, minMarketCap: 5e9 };
}

// No UI countdown — waits waitSeconds between batches server-side as a
// rate-limit buffer against FMP. waitSeconds is overridable for tests.
async function runScan({
  key, batchSize = CF_BATCH, maxBatches = CF_MAX_BATCHES, qualityPreset = 'standard',
  waitSeconds = CF_WAIT_SECONDS, scanDays = 7,
} = {}) {
  const quality = resolveQuality(qualityPreset);
  const universe = await assembleUniverse();
  const batches = buildBatches(universe, batchSize, maxBatches);

  const allResults = [];
  for (let i = 0; i < batches.length; i++) {
    const r = await scanBatch(batches[i], key, quality, scanDays);
    allResults.push(...r);
    if (i < batches.length - 1 && waitSeconds > 0) await sleep(waitSeconds * 1000);
  }

  return { universeSize: universe.length, scanned: allResults.length, results: allResults };
}

function filterCandidates(results, threshold) {
  return results
    .filter((r) => !r.filterFail && !r.noData && r.changePct !== undefined && r.changePct <= -threshold)
    .sort((a, b) => a.changePct - b.changePct);
}

module.exports = {
  CF_BATCH, CF_MAX, CF_MAX_BATCHES, CF_ETF_LIST, CF_STRENGTH_LOOKBACK,
  assembleUniverse, scanStock, buildBatches, scanBatch, runScan, filterCandidates, resolveQuality,
};
