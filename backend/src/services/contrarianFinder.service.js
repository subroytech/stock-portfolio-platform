// Ported from CreateStockPortfolioViewWOSkill/js/contrarian-finder.js —
// universe assembly + per-stock scan logic is pure/portable; the fetch
// wrapper is refactored to call FMP via env-configured base URLs instead of
// the browser fetch + localStorage key, and all UI orchestration (progress
// bars, cfRun's DOM wiring) is dropped — the backend now rate-limits itself
// against FMP server-side instead of driving a visual countdown.

const env = require('../config/env');
const { CF_ETF_LIST, CF_STATIC } = require('../db/seed/cf_static_universe');

const CF_BATCH = 150;
const CF_WAIT_SECONDS = 60;
const CF_MAX = 450;
const CF_MAX_BATCHES = 3;

async function cfFetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (data?.['Error Message']) return { ok: false, status: 401 };
    return { ok: true, data };
  } catch (_e) {
    return { ok: false, status: 0 };
  }
}

async function assembleUniverse(key) {
  const seen = new Set();
  const universe = [];
  const add = (sym, tier, source) => {
    const s = sym?.toString().toUpperCase().trim();
    if (!s || s.length > 7 || seen.has(s) || universe.length >= CF_MAX) return;
    seen.add(s);
    universe.push({ symbol: s, tier, source });
  };

  // Tier 1: DJ30
  const dj30 = await cfFetchJson(`${env.fmpBaseUrl}/dowjones-constituent?apikey=${key}`);
  if (dj30.ok) (Array.isArray(dj30.data) ? dj30.data : []).forEach((s) => add(s.symbol, 1, 'DJ30'));
  else CF_STATIC.dj30.forEach((s) => add(s, 1, 'DJ30'));

  // Tier 2: NDX100
  const ndx = await cfFetchJson(`${env.fmpBaseUrl}/nasdaq-constituent?apikey=${key}`);
  if (ndx.ok) (Array.isArray(ndx.data) ? ndx.data : []).forEach((s) => add(s.symbol, 2, 'NDX100'));
  else CF_STATIC.ndx100.forEach((s) => add(s, 2, 'NDX100'));

  // Tier 3: S&P 500 Top 200
  const sp5 = await cfFetchJson(`${env.fmpBaseUrl}/sp500-constituent?apikey=${key}`);
  if (sp5.ok) {
    let n = 0;
    for (const s of Array.isArray(sp5.data) ? sp5.data : []) {
      if (n >= 200) break;
      const before = universe.length;
      add(s.symbol, 3, 'S&P 500');
      if (universe.length > before) n++;
    }
  } else CF_STATIC.sp500.forEach((s) => add(s, 3, 'S&P 500'));

  // Tier 4: Sector ETF constituents
  for (const etf of CF_ETF_LIST) {
    if (universe.length >= CF_MAX) break;
    const res = await cfFetchJson(`${env.fmp3BaseUrl}/etf-holder/${etf}?apikey=${key}`);
    if (res.ok) (Array.isArray(res.data) ? res.data : []).forEach((h) => add(h.asset || h.symbol, 4, etf));
    else (CF_STATIC.etf[etf] || []).forEach((s) => add(s, 4, etf));
  }

  return universe;
}

async function scanStock(sym, key, quality) {
  const [qr, hr] = await Promise.allSettled([
    cfFetchJson(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${key}`),
    cfFetchJson(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${sym}&limit=7&apikey=${key}`),
  ]);

  const q = (qr.status === 'fulfilled' && qr.value.ok) ? (Array.isArray(qr.value.data) ? qr.value.data[0] : qr.value.data) : null;
  const hist = (hr.status === 'fulfilled' && hr.value.ok) ? (Array.isArray(hr.value.data) ? hr.value.data : (hr.value.data?.historical || [])) : [];

  const price = q?.price ?? null;
  const mktCap = q?.marketCap ?? null;

  const filterFail = (!price || price < quality.minPrice) || (!mktCap || mktCap < quality.minMarketCap);
  if (filterFail) return { symbol: sym, filterFail: true };

  if (hist.length < 6) return { symbol: sym, filterFail: false, noData: true };

  const today = new Date().toISOString().slice(0, 10);
  const mktClosed = hist[0]?.date === today;
  const endPrice = mktClosed ? hist[0].close : price;
  const startClose = mktClosed ? hist[5].close : hist[4]?.close;

  if (!endPrice || !startClose || startClose === 0) return { symbol: sym, filterFail: false, noData: true };

  return {
    symbol: sym,
    name: q?.name || '',
    sector: q?.sector || '',
    price,
    mktCap,
    volume: q?.volume ?? null,
    avgVol: q?.avgVolume ?? null,
    change5d: (endPrice - startClose) / startClose * 100,
    mktClosed,
    filterFail: false,
    noData: false,
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

async function scanBatch(stocks, key, quality) {
  const settled = await Promise.allSettled(stocks.map(async (stock) => {
    const r = await scanStock(stock.symbol, key, quality);
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

// No UI countdown — waits CF_WAIT_SECONDS between batches server-side as a
// rate-limit buffer against FMP. waitSeconds is overridable for tests.
async function runScan({ key, batchSize = CF_BATCH, maxBatches = CF_MAX_BATCHES, qualityPreset = 'standard', waitSeconds = CF_WAIT_SECONDS } = {}) {
  const quality = resolveQuality(qualityPreset);
  const universe = await assembleUniverse(key);
  const batches = buildBatches(universe, batchSize, maxBatches);

  const allResults = [];
  for (let i = 0; i < batches.length; i++) {
    const r = await scanBatch(batches[i], key, quality);
    allResults.push(...r);
    if (i < batches.length - 1 && waitSeconds > 0) await sleep(waitSeconds * 1000);
  }

  return { universeSize: universe.length, scanned: allResults.length, results: allResults };
}

function filterCandidates(results, threshold) {
  return results
    .filter((r) => !r.filterFail && !r.noData && r.change5d !== undefined && r.change5d <= -threshold)
    .sort((a, b) => a.change5d - b.change5d);
}

module.exports = {
  CF_BATCH, CF_MAX, CF_MAX_BATCHES, CF_ETF_LIST,
  assembleUniverse, scanStock, buildBatches, scanBatch, runScan, filterCandidates, resolveQuality,
};
