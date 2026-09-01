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
import { fmpGet, HistoricalBar, getProfiles } from './marketData.service';
import { mwSMA, mwRSI, mwBB } from './momentum.service';
import { getConfigInt } from './configProperty.service';
import * as analysisService from './analysisService';

export const CF_ETF_LIST: string[] = ['XLK', 'XLV', 'XLF', 'XLY', 'XLI', 'XLC', 'XLP', 'XLE', 'XLB', 'XLU', 'XLRE'];
export const CF_BATCH = 125;
export const CF_MAX = 600;
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

export interface UniverseIndexInfo {
  id: string;
  description: string;
}

export interface UniverseStockRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null;
  indices: string[];
}

export interface UniverseTable {
  indices: UniverseIndexInfo[];
  stocks: UniverseStockRow[];
}

// Fixed display order (not DB row order, which Postgres/CockroachDB doesn't
// guarantee) - matches the seed script's INDEX_DESCRIPTIONS ordering.
const UNIVERSE_INDEX_ORDER = ['DJ30', 'NDX100', 'SP500', ...CF_ETF_LIST];

// A reference table for the Contrarian Finder page's "Stock Universe" section
// - distinct from assembleUniverse() above, which stays capped/dedup'd/single
// -tier for the actual scan orchestration. This one shows EVERY index a stock
// belongs to (many stocks are in more than one - e.g. AAPL is in DJ30, S&P
// 500, and XLK), which assembleUniverse()'s "first index it matched" tier
// can't represent.
export async function getUniverseTable(): Promise<UniverseTable> {
  const { rows: indexRows } = await pool.query<{ index_id: string; index_description: string }>(
    'SELECT index_id, index_description FROM m_index_master',
  );
  const indices = UNIVERSE_INDEX_ORDER
    .map((id) => indexRows.find((r) => r.index_id === id))
    .filter((r): r is { index_id: string; index_description: string } => !!r)
    .map((r) => ({ id: r.index_id, description: r.index_description }));

  const { rows } = await pool.query<{ symbol: string; name: string | null; sector: string | null; market_cap: string | null; index_ids: string[] }>(`
    SELECT ic.symbol, t.name, t.sector, t.market_cap, array_agg(ic.index_id ORDER BY ic.index_id) AS index_ids
    FROM m_index_constituent ic
    LEFT JOIN m_tickers t ON t.symbol = ic.symbol
    GROUP BY ic.symbol, t.name, t.sector, t.market_cap
  `);

  const stocks = rows
    .map((r) => ({
      symbol: r.symbol, name: r.name, sector: r.sector,
      marketCap: r.market_cap != null ? Number(r.market_cap) : null, // NUMERIC comes back as a string from pg
      indices: r.index_ids,
    }))
    .sort((a, b) => b.indices.length - a.indices.length || a.symbol.localeCompare(b.symbol));

  return { indices, stocks };
}

export interface TickerRefreshResult {
  updated: number;
  skipped: number;
}

// Shared by two consumers: "Run Scan (+ Mkt Cap)" (mode 'all' - piggybacks on
// a real scan's own batch, refreshing every symbol in it regardless of
// current state) and the Admin Console's Master Data "Delta Update" (mode
// 'missing' - a lighter, standalone action that only touches gaps). Uses
// getProfiles() (FMP /profile) as a single consistent source for all three
// fields, rather than mixing in the scan's own /quote-sourced name/marketCap
// - "+ Mkt Cap" is deliberately a heavier variant with its own progress bar,
// so the extra FMP calls this costs are an accepted tradeoff, not an oversight.
export async function refreshTickerDataBatch(
  stocks: UniverseEntry[], apiKey: string, mode: 'missing' | 'all',
): Promise<TickerRefreshResult> {
  const symbols = stocks.map((s) => s.symbol);
  let targetSymbols = symbols;

  if (mode === 'missing') {
    // LEFT JOIN (via unnest), not just "WHERE some column IS NULL" - a symbol
    // with NO m_tickers row at all must also count as missing (exactly what
    // portfolio-import's bare-insert path and brand-new universe symbols
    // produce), not just an existing row with a null field.
    const { rows } = await pool.query<{ symbol: string }>(
      `SELECT s.symbol FROM unnest($1::text[]) AS s(symbol)
       LEFT JOIN m_tickers t ON t.symbol = s.symbol
       WHERE t.symbol IS NULL OR t.name IS NULL OR t.sector IS NULL OR t.market_cap IS NULL`,
      [symbols],
    );
    targetSymbols = rows.map((r) => r.symbol);
  }

  if (targetSymbols.length === 0) return { updated: 0, skipped: symbols.length };

  const profiles = await getProfiles(targetSymbols, apiKey);
  const entries = Object.entries(profiles).filter(([, p]) => p.name || p.sector || p.marketCap != null);

  if (entries.length > 0) {
    const values = entries.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
    const params = entries.flatMap(([symbol, p]) => [symbol, p.name || null, p.sector || null, p.marketCap]);
    await pool.query(
      `INSERT INTO m_tickers (symbol, name, sector, market_cap) VALUES ${values}
       ON CONFLICT (symbol) DO UPDATE SET
         name = COALESCE(excluded.name, m_tickers.name),
         sector = COALESCE(excluded.sector, m_tickers.sector),
         market_cap = COALESCE(excluded.market_cap, m_tickers.market_cap),
         updated_at = now()`,
      params,
    );
  }

  return { updated: entries.length, skipped: symbols.length - entries.length };
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

// ── Python-extraction path (2026-07-29) ─────────────────────────────────────
// scanStock()/scanBatch() above stay untouched as the rollback path (same
// precedent as momentum.service.ts's assembleMomentumAnalysis). These new
// functions split scanStock's fetch (stays here, Node owns all FMP calls)
// from its scoring (moved to analysis-service/app/scoring/contrarian_finder.py,
// which reuses the already-ported mw_sma/mw_rsi/mw_bb from momentum.py).

export interface RawQuoteData {
  price: number | null;
  marketCap: number | null;
  name: string | null;
  sector: string | null;
  volume: number | null;
  avgVolume: number | null;
}

export interface RawHistoricalBar {
  date: string | null;
  close: number | null;
  low: number | null;
}

export interface RawStockData {
  symbol: string;
  quote: RawQuoteData | null;
  historicalBars: RawHistoricalBar[];
}

// The FMP-fetch half of today's scanStock() (its two fmpGet calls), with no
// scoring - just normalizes the raw response into RawStockData. Bars are
// NOT filtered/dropped here even when close/low fail to parse (kept as
// null) - the scoring step needs the same array length/order as today's
// scanStock for its index-based changePct lookups (hist[0], hist[scanDays]).
export async function fetchStockData(sym: string, key: string, scanDays = 7): Promise<RawStockData> {
  const limit = Math.max(scanDays + 2, CF_STRENGTH_LOOKBACK);
  const [qr, hr] = await Promise.allSettled([
    fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${key}`),
    fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${sym}&limit=${limit}&apikey=${key}`),
  ]);

  const q = (qr.status === 'fulfilled' && qr.value) ? (Array.isArray(qr.value) ? qr.value[0] : qr.value) : null;
  const histRaw: HistoricalBar[] = (hr.status === 'fulfilled' && hr.value) ? (Array.isArray(hr.value) ? hr.value : (hr.value?.historical || [])) : [];

  const quote: RawQuoteData | null = q ? {
    price: q.price ?? null,
    marketCap: q.marketCap ?? null,
    name: q.name || null,
    sector: q.sector || null,
    volume: q.volume ?? null,
    avgVolume: q.avgVolume ?? null,
  } : null;

  const parseOrNull = (v: unknown): number | null => {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const historicalBars: RawHistoricalBar[] = histRaw.map((h) => ({
    date: h.date != null ? String(h.date) : null,
    close: parseOrNull(h.close),
    low: parseOrNull(h.low),
  }));

  return { symbol: sym, quote, historicalBars };
}

// Replaces today's scanBatch() as what the controller actually calls: fetches
// the sector map (DB, unchanged) and every stock's raw data (FMP, unchanged)
// in parallel, sends the whole batch's raw data to analysis-service in ONE
// call, then overlays the sector-map fallback onto Python's results - same
// `sectorMap[symbol] || result.sector` logic as today, just applied after the
// Python round-trip instead of after scanStock.
export async function assembleScanBatch(stocks: UniverseEntry[], key: string, quality: ScanQuality, scanDays?: number): Promise<ScanResult[]> {
  const sectorMap = await fetchSectorMap(stocks.map((s) => s.symbol));

  // fetchStockData never rejects (same contract as today's scanStock - a
  // failed FMP call just becomes a null quote/empty history, scored by
  // Python as a natural filterFail rather than surfaced as an error here),
  // so a plain Promise.all is enough - no allSettled/error-partitioning needed.
  const rawData = await Promise.all(stocks.map((stock) => fetchStockData(stock.symbol, key, scanDays)));

  const scored = rawData.length > 0
    ? await analysisService.computeContrarianFinderScanBatch({ stocks: rawData, quality, scanDays: scanDays ?? 7 })
    : [];

  const bySymbol = new Map(scored.map((r) => [r.symbol, r]));

  // Defensive, not speculative: this guards against analysis-service
  // returning fewer rows than requested (e.g. a symbol dropped mid-batch),
  // not against a failure mode fetchStockData can actually produce.
  return stocks.map((stock) => {
    const result = bySymbol.get(stock.symbol);
    if (!result) return { symbol: stock.symbol, filterFail: true, error: true };
    result.source = stock.source;
    result.sector = sectorMap[stock.symbol] || result.sector;
    return result;
  });
}

export interface LastScanRecord {
  completedAt: string;
  universeSize: number;
  scanned: number;
  params: unknown;
  results: unknown;
}

export type ContrarianRunTier = 'admin' | 'user';

// Admin/admin-master runs keep a rolling history, capped here rather than
// via CockroachDB's row-level TTL (added 2026-08-05) - a count-based cap,
// not a time-based one, since scan cadence isn't predictable enough for a
// TTL window to reliably mean "last 60 runs."
//
// Config Properties framework (2026-08-24) - this limit is now admin-configurable via
// m_config_property (key: contrarian_finder_admin_history_retention_count, seeded to 60 in
// migration 027) instead of a hardcoded constant. ADMIN_HISTORY_LIMIT_FALLBACK is a defensive
// last resort only: getConfigInt never throws, but if the config row is ever missing or
// unparseable it logs a warning and falls back to this literal, rather than letting the prune
// query below run with undefined/NaN/0 - this is a business-critical cap, not something that
// should silently no-op (unbounded growth) or wipe the whole history.
const ADMIN_HISTORY_RETENTION_KEY = 'contrarian_finder_admin_history_retention_count';
const ADMIN_HISTORY_LIMIT_FALLBACK = 60;

// Persists the last completed scan server-side (2026-08-04) so it's shared
// across every user, not just the browser that ran it - see api/
// contrarianFinder.ts's sessionStorage-only persistence, which this
// complements rather than replaces (the runner's own browser still shows
// results instantly from its local cache; this is the fallback for anyone
// else). Called once, at the end of a successfully completed scan - never
// for a partial/abandoned one. params/results are opaque JSONB from this
// service's perspective (the frontend's RunParams/ScanResult[] shapes are
// the source of truth); no validation beyond what the DB itself enforces.
//
// Tiered retention (2026-08-05, the user's own call after noticing every
// run - regardless of who ran it - was accumulating forever): callers with
// contrarian_finder:scan_history (admin/admin-master, resolved by the
// controller) append to a shared history log, pruned back to the most
// recent ADMIN_HISTORY_LIMIT rows after every insert. Every other
// contrarian_finder:scan-permitted caller (user-contra-withKey/wokey)
// instead gets exactly one row of their own - a transactional delete+insert
// upsert keyed on (started_by, run_tier = 'user'), same "my last scan"
// mental model the user described, distinct from the admin tier's shared
// history. GET /contrarian-finder/last-scan is deliberately unaffected by
// any of this - still just the single most recent row across both tiers.
export async function saveLastScan(
  userId: string,
  runTier: ContrarianRunTier,
  data: { universeSize: number; scanned: number; params: unknown; results: unknown },
): Promise<void> {
  const values = [userId, data.universeSize, data.scanned, JSON.stringify(data.params), JSON.stringify(data.results)];

  if (runTier === 'user') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM tx_shared_contrarian_run WHERE started_by = $1 AND run_tier = 'user'`,
        [userId],
      );
      await client.query(
        `INSERT INTO tx_shared_contrarian_run (started_by, run_tier, universe_size, scanned, params, results)
         VALUES ($1, 'user', $2, $3, $4, $5)`,
        values,
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* best-effort */ });
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  const historyLimit = await getConfigInt(ADMIN_HISTORY_RETENTION_KEY, ADMIN_HISTORY_LIMIT_FALLBACK);

  await pool.query(
    `INSERT INTO tx_shared_contrarian_run (started_by, run_tier, universe_size, scanned, params, results)
     VALUES ($1, 'admin', $2, $3, $4, $5)`,
    values,
  );
  await pool.query(
    `DELETE FROM tx_shared_contrarian_run
     WHERE run_tier = 'admin' AND id NOT IN (
       SELECT id FROM tx_shared_contrarian_run WHERE run_tier = 'admin' ORDER BY completed_at DESC LIMIT $1
     )`,
    [historyLimit],
  );
}

// Every row is a completed run (save-once-at-the-end means nothing else gets
// written) - "the last scan" is just the most recent row, no status filter
// needed. started_by is intentionally not selected/returned here - stored
// for a possible future audit trail, not yet exposed to viewers.
export async function getLastScan(): Promise<LastScanRecord | null> {
  const { rows } = await pool.query<{
    completed_at: string; universe_size: string; scanned: string; params: unknown; results: unknown;
  }>(
    `SELECT completed_at, universe_size, scanned, params, results
     FROM tx_shared_contrarian_run ORDER BY completed_at DESC LIMIT 1`,
  );
  if (!rows[0]) return null;
  const r = rows[0];
  // INT8 columns come back as strings from pg - see marketData/roles services
  // for the same precedent.
  return {
    completedAt: r.completed_at,
    universeSize: Number(r.universe_size),
    scanned: Number(r.scanned),
    params: r.params,
    results: r.results,
  };
}

export interface RunHistoryListItem {
  id: string;
  completedAt: string;
  universeSize: number;
  scanned: number;
  params: unknown;
}

// Run History (2026-08-31, gated by contrarian_finder:view_history - see
// requirePermission on the routes below). Tier-agnostic, same "viewing
// ignores tier" philosophy getLastScan() already established - run_tier is a
// retention/storage concept only, never a viewing one. `results` (the
// ~150KB-per-row JSONB blob) is deliberately excluded here to keep this
// list call cheap; fetched only per-row, on demand, via getRunById below. No
// pagination - a deliberate MVP simplification worth revisiting if retention
// caps grow much larger than today's numbers.
export async function listRunHistory(): Promise<RunHistoryListItem[]> {
  const { rows } = await pool.query<{
    id: string; completed_at: string; universe_size: string; scanned: string; params: unknown;
  }>(
    `SELECT id, completed_at, universe_size, scanned, params
     FROM tx_shared_contrarian_run ORDER BY completed_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    completedAt: r.completed_at,
    universeSize: Number(r.universe_size),
    scanned: Number(r.scanned),
    params: r.params,
  }));
}

// The full record (including `results`) for one archived run, keyed by id
// instead of getLastScan()'s "most recent" - same shape either way so the
// frontend can render both through identical components.
export async function getRunById(id: string): Promise<LastScanRecord | null> {
  const { rows } = await pool.query<{
    completed_at: string; universe_size: string; scanned: string; params: unknown; results: unknown;
  }>(
    `SELECT completed_at, universe_size, scanned, params, results
     FROM tx_shared_contrarian_run WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    completedAt: r.completed_at,
    universeSize: Number(r.universe_size),
    scanned: Number(r.scanned),
    params: r.params,
    results: r.results,
  };
}
