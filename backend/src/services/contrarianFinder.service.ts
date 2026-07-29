// Ported from CreateStockPortfolioViewWOSkill/js/contrarian-finder.js —
// universe assembly + per-stock scan logic is pure/portable; the fetch
// wrapper is refactored to call FMP via env-configured base URLs instead of
// the browser fetch + localStorage key.
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
// from db/seed/cf_static_universe.ts via seedTickerData.ts) — same static
// data, now queryable/editable without a code deploy.
//
// Batch orchestration moved to the frontend 2026-07-27 — assembleUniverse()/
// buildBatches()/scanBatch() are called once per batch by a new per-batch
// controller endpoint instead of one long-held request looping every batch
// with a server-side sleep(). The frontend now paces itself between calls
// (same ~62s rate-limit buffer, just client-side), which also gives it real
// batch-by-batch progress instead of an estimate. assembleUniverse() is
// deterministic (ORDER BY on fetchConstituents()'s query) so recomputing it
// fresh on every batch request is safe and cheap.

import env from '../config/env';
import { pool } from '../db/pool';
import { fmpGet, HistoricalBar } from './marketData.service';
import { mwSMA, mwRSI, mwBB } from './momentum.service';

export const CF_ETF_LIST: string[] = ['XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLB', 'XLU', 'XLRE'];
export const CF_BATCH = 125;
export const CF_MAX = 450;
export const CF_MAX_BATCHES = 3;
export const CF_STRENGTH_LOOKBACK = 60; // bars needed for SMA50/RSI14 strength screen

export interface UniverseEntry {
  symbol: string;
  tier: number;
  source: string;
}

// Sector isn't reliably available from FMP's /quote response — confirmed
// live 2026-07-27 that /stable/quote has no sector field at all (same class
// of gap as profile.pe not existing, which made Long-Term Analysis's
// original forward-P/E rule dead code). Backfilled from the already-seeded
// m_tickers reference table (ticker_sectors.ts, ~200 curated large-cap
// symbols) instead of adding a third FMP call per stock — one batched
// lookup covers a whole scan batch. Coverage is partial: less-common
// tickers outside that curated set still come back with an empty sector.
async function fetchSectorMap(symbols: string[]): Promise<Record<string, string>> {
  if (symbols.length === 0) return {};
  const { rows } = await pool.query<{ symbol: string; sector: string | null }>(
    'SELECT symbol, sector FROM m_tickers WHERE symbol = ANY($1)',
    [symbols],
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.sector) map[row.symbol] = row.sector;
  }
  return map;
}

async function fetchConstituents(indexId: string): Promise<string[]> {
  // ORDER BY makes batch composition reproducible run-to-run — CockroachDB/Postgres
  // doesn't guarantee row order without it, unlike the source app's static array.
  const { rows } = await pool.query<{ symbol: string }>('SELECT symbol FROM m_index_constituent WHERE index_id = $1 ORDER BY symbol', [indexId]);
  return rows.map((r) => r.symbol);
}

// Built from index_master/index_constituent — see header note above for why
// the live FMP constituent-fetch path was removed rather than kept as a
// primary attempt with a fallback.
export async function assembleUniverse(): Promise<UniverseEntry[]> {
  const seen = new Set<string>();
  const universe: UniverseEntry[] = [];
  const add = (sym: string, tier: number, source: string) => {
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

export interface ScanQuality {
  minPrice: number;
  minMarketCap: number;
}

export interface StrengthSignal {
  rsi: number;
  sma20: number;
  sma50: number;
  rr: number;
  kF: number;
  halfKelly: number;
}

export interface ScanResult {
  symbol: string;
  filterFail: boolean;
  noData?: boolean;
  error?: boolean;
  name?: string;
  sector?: string;
  price?: number | null;
  mktCap?: number | null;
  volume?: number | null;
  avgVol?: number | null;
  changePct?: number;
  changeSinceDate?: string; // the actual trading-day date changePct is measured from (YYYY-MM-DD)
  mktClosed?: boolean;
  strength?: StrengthSignal | null;
  source?: string;
}

export async function scanStock(sym: string, key: string, quality: ScanQuality, scanDays = 7): Promise<ScanResult> {
  const limit = Math.max(scanDays + 2, CF_STRENGTH_LOOKBACK);
  const [qr, hr] = await Promise.allSettled([
    fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${key}`),
    fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${sym}&limit=${limit}&apikey=${key}`),
  ]);

  const q = (qr.status === 'fulfilled' && qr.value) ? (Array.isArray(qr.value) ? qr.value[0] : qr.value) : null;
  const hist: HistoricalBar[] = (hr.status === 'fulfilled' && hr.value) ? (Array.isArray(hr.value) ? hr.value : (hr.value?.historical || [])) : [];

  const price = q?.price ?? null;
  const mktCap = q?.marketCap ?? null;

  const filterFail = (!price || price < quality.minPrice) || (!mktCap || mktCap < quality.minMarketCap);
  if (filterFail) return { symbol: sym, filterFail: true };

  if (hist.length < scanDays + 1) return { symbol: sym, filterFail: false, noData: true };

  const today = new Date().toISOString().slice(0, 10);
  const mktClosed = hist[0]?.date === today;
  const endPrice = mktClosed ? hist[0].close : price;
  // scanDays counts trading days, not calendar days - hist has one row per
  // actual trading session (FMP's EOD data never includes weekends/market
  // holidays), so indexing scanDays back is already weekend/holiday-safe.
  const startBar = mktClosed ? hist[scanDays] : hist[scanDays - 1];
  const startClose = startBar?.close;

  if (!endPrice || !startClose || startClose === 0) return { symbol: sym, filterFail: false, noData: true };

  const changePct = (Number(endPrice) - Number(startClose)) / Number(startClose) * 100;
  const changeSinceDate = startBar?.date;

  // Bullish "strength" screen - RSI ideal zone + above both SMAs + hasn't already spiked.
  let strength: StrengthSignal | null = null;
  const closes = hist.map((h) => parseFloat(String(h.close))).filter((v) => !Number.isNaN(v));
  const lows = hist.map((h) => parseFloat(String(h.low))).filter((v) => !Number.isNaN(v));
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
    changeSinceDate,
    mktClosed,
    filterFail: false,
    noData: false,
    strength,
  };
}

export function buildBatches(universe: UniverseEntry[], batchSize: number, maxBatches: number): UniverseEntry[][] {
  const toScan = universe.slice(0, batchSize * maxBatches);
  const batches: UniverseEntry[][] = [];
  for (let i = 0; i < maxBatches; i++) {
    const slice = toScan.slice(i * batchSize, (i + 1) * batchSize);
    if (slice.length > 0) batches.push(slice);
  }
  return batches;
}

export async function scanBatch(stocks: UniverseEntry[], key: string, quality: ScanQuality, scanDays?: number): Promise<ScanResult[]> {
  const sectorMap = await fetchSectorMap(stocks.map((s) => s.symbol));

  const settled = await Promise.allSettled(stocks.map(async (stock) => {
    const r = await scanStock(stock.symbol, key, quality, scanDays);
    r.source = stock.source;
    r.sector = sectorMap[stock.symbol] || r.sector;
    return r;
  }));
  return settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { symbol: stocks[i].symbol, filterFail: true, error: true }));
}

export function resolveQuality(qualityPreset?: string): ScanQuality {
  return qualityPreset === 'relaxed' ? { minPrice: 5, minMarketCap: 2.5e9 } : { minPrice: 10, minMarketCap: 5e9 };
}

export function filterCandidates(results: ScanResult[], threshold: number): ScanResult[] {
  return results
    .filter((r) => !r.filterFail && !r.noData && r.changePct !== undefined && r.changePct <= -threshold)
    .sort((a, b) => (a.changePct as number) - (b.changePct as number));
}
