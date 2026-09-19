// Stock Analysis - Candlestick Charts (Phase 1 + 1.1). Orchestrates: reading cached bars (never
// fetches), the explicit rate-limited real fetch, and the cached-symbols list backing the new
// left-side panel. '1day' deliberately reuses the EXISTING daily-bar path
// (marketData.service.ts/fmpDailyCache.service.ts) rather than the new intraday cache - only
// 5min/15min/30min/1hour/4hour are new. 1min was considered and dropped after a live FMP check
// returned a genuine 402 (plan-tier restriction) - see migration 044's header comment.

import { pool } from '../db/pool';
import env from '../config/env';
import * as marketData from './marketData.service';
import * as fmpDailyCache from './fmpDailyCache.service';
import * as fmpIntradayCache from './fmpIntradayCache.service';
import * as momentum from './momentum.service';
import * as candlestickIndicators from './candlestickIndicators.service';
import * as userSubscription from './userSubscription.service';
import * as usageTracking from './usageTracking.service';
import { checkCandlestickRateLimit } from './candlestickRateLimit.service';
import type { CandlestickBar } from './candlestickIndicators.service';

export type CandlestickInterval = '5min' | '15min' | '30min' | '1hour' | '4hour' | '1day';
export const CANDLESTICK_INTERVALS: CandlestickInterval[] = ['5min', '15min', '30min', '1hour', '4hour', '1day'];

export class CandlestickRateLimitExceededError extends Error {}

export interface CandlestickSnapshot {
  bars: CandlestickBar[];
  indicators: Record<string, unknown>;
  updatedAt: string;
  isFresh: boolean;
}

// Phase 1.1 - per-interval display window (what the user actually sees) and lookback buffer
// (extra earlier history fetched/cached, never displayed, purely so SMA50 has real trailing data
// for every DISPLAYED bar, not just the newest one - SMA50 needs 50 trailing bars behind every
// point it plots). Not wasted even though it's trimmed out of every response: the cache
// (m_stock_ticker_candlestick_cache) keeps the full buffered range, so a future "expand the
// view" feature could serve instantly from what's already cached, up to the buffer's extent.
//
// displayDays sized 2026-09-18 to target ~150-170 displayed bars per interval (a "meaningfully
// full" chart width, per live review of the original narrower ranges - 15min/30min/4hour in
// particular were visibly sparse at ~20-26 bars) - using the REAL bars-per-trading-day ratios
// confirmed live (78/26/13/7/2/1 for 5min/15min/30min/1hour/4hour/1day; 1hour/4hour came in
// higher than a naive 6.5hr-session estimate would suggest, likely FMP's own bucketing), not the
// original rough estimates. Calendar-day conversion uses a 7/5 weekday ratio, rounded up for
// margin. Caveat: for the shortest intervals (5min especially, where one trading day is a full
// 78-bar swing) a fixed calendar-day cutoff can't hit an exact bar count every single day
// regardless of which weekday "today" is - this targets the middle of the range on average, not
// a guaranteed exact count.
//
// bufferDays sizing unchanged in method: ceil(50 / bars-per-trading-day), converted to calendar
// days with the same weekday margin - estimates, not exact; nudge after seeing real FMP bar
// counts if needed.
export const INTERVAL_RANGES: Record<CandlestickInterval, { displayDays: number; bufferDays: number }> = {
  '5min': { displayDays: 3, bufferDays: 2 },
  '15min': { displayDays: 9, bufferDays: 3 },
  '30min': { displayDays: 17, bufferDays: 6 },
  '1hour': { displayDays: 33, bufferDays: 12 },
  '4hour': { displayDays: 112, bufferDays: 35 },
  '1day': { displayDays: 224, bufferDays: 70 },
};

// The six indicators that need real trailing history to be accurate from the first DISPLAYED
// bar onward - computed once over the full wide/buffered bars (see buildDisplaySnapshot).
// vwap/pivotPoints/fibonacci/volume are deliberately NOT here - see computeWindowRelativeIndicators.
const HISTORY_DEPENDENT_KEYS = ['sma20', 'sma50', 'ema20', 'rsi14', 'macd', 'bb20'] as const;

function extractBars(raw: unknown): CandlestickBar[] {
  const arr = Array.isArray(raw) ? raw : ((raw as { historical?: unknown[] })?.historical ?? []);
  return (arr as Record<string, unknown>[]).map((b) => ({
    date: String(b.date),
    open: parseFloat(String(b.open)),
    high: parseFloat(String(b.high)),
    low: parseFloat(String(b.low)),
    close: parseFloat(String(b.close)),
    volume: Math.max(parseInt(String(b.volume)) || 0, 0),
  }));
}

// FMP's intraday bars use "YYYY-MM-DD HH:mm:ss" (a space, not the ISO 'T' separator) - not
// reliably parsed by `new Date(...)` in every engine. Daily bars are already a bare
// "YYYY-MM-DD", which parses fine either way. Mirrors the frontend's own parseBarTime.
function parseBarDate(date: string): number {
  return new Date(date.replace(' ', 'T')).getTime();
}

// Guards against a real bug found live 2026-09-18: a cache row written before Phase 1.1
// introduced the full-series shape for these six keys still holds the OLD single-value/single-
// object shape (sma20 as a bare number, macd as one MacdIndicator, etc. - the same shape
// momentum.service.ts's own single-snapshot functions return). getSnapshot() never recomputes on
// read, so an un-refreshed row would otherwise be passed straight through to the frontend, which
// crashes trying to spread a non-array. Used to self-heal such a row at read time instead of
// requiring a one-time migration or a user-triggered refresh.
function isValidHistorySeries(series: Record<string, unknown>): boolean {
  return HISTORY_DEPENDENT_KEYS.every((key) => {
    const value = series[key];
    return value === null || Array.isArray(value);
  });
}

// Reuses momentum.service.ts's existing, tested SMA/EMA/RSI/Bollinger Bands/MACD directly rather
// than reimplementing them - only VWAP/Pivot Points/Fibonacci Retracement (window-relative, see
// below) are new. sma20/sma50/bb20 use candlestickIndicators.service.ts's rolling-window series
// wrappers (exactly correct, since each reading only depends on its own trailing window); rsi14/
// macd get their own real continuous-state series there instead, since naively reseeding
// mwRSI/mwMACD per window would silently diverge from a textbook-correct reading. ema20 is the
// one case mwEMA already returns a full series for. bars must be newest-first. This is what gets
// cached (over the full wide/buffered bars) - never trimmed to the display window itself, so a
// future wider view could reuse it.
function computeHistorySeries(bars: CandlestickBar[]): Record<string, unknown> {
  const closes = bars.map((b) => b.close);
  return {
    sma20: candlestickIndicators.computeSmaSeries(closes, 20),
    sma50: candlestickIndicators.computeSmaSeries(closes, 50),
    ema20: closes.length >= 20 ? momentum.mwEMA(closes, 20) : null,
    rsi14: candlestickIndicators.computeRsiSeries(closes, 14),
    macd: candlestickIndicators.computeMacdSeries(closes),
    bb20: candlestickIndicators.computeBbSeries(closes, 20),
  };
}

// Conventionally session/view-relative, not multi-day-history-relative - computed fresh over
// whatever bars are actually being displayed (never the hidden buffer), never cached. VWAP is
// defined as cumulative from the start of whatever window it's computed over - accumulating it
// across invisible buffer days before the visible window would produce a number that doesn't
// mean what a viewer expects. A swing high/low (Fibonacci) found in a hidden buffer bar, outside
// what's ever shown, would be a confusing anchor. Cheap pure functions - recomputing on every
// read costs nothing like a real FMP call would.
function computeWindowRelativeIndicators(bars: CandlestickBar[]): Record<string, unknown> {
  return {
    volume: bars.map((b) => b.volume),
    vwap: candlestickIndicators.computeVWAP(bars),
    pivotPoints: candlestickIndicators.computePivotPoints(bars),
    fibonacci: candlestickIndicators.computeFibonacciRetracement(bars),
  };
}

// The core Phase 1.1 pipeline: wide (buffered) bars + their precomputed history series in ->
// trim both down to the interval's display window by date cutoff -> compute the window-relative
// three fresh over just the trimmed bars. Called on every read (getSnapshot and refresh alike) -
// what's cached/fetched always stays wide; only the response is ever trimmed.
function buildDisplaySnapshot(
  wideBars: CandlestickBar[],
  wideHistorySeries: Record<string, unknown>,
  interval: CandlestickInterval,
): { bars: CandlestickBar[]; indicators: Record<string, unknown> } {
  const { displayDays } = INTERVAL_RANGES[interval];
  const cutoff = Date.now() - displayDays * 24 * 60 * 60 * 1000;
  const keepCount = wideBars.filter((b) => parseBarDate(b.date) >= cutoff).length;
  const trimmedBars = wideBars.slice(0, keepCount);

  const trimmedHistorySeries: Record<string, unknown> = {};
  for (const key of HISTORY_DEPENDENT_KEYS) {
    const series = wideHistorySeries[key];
    trimmedHistorySeries[key] = Array.isArray(series) ? series.slice(0, keepCount) : series;
  }

  return { bars: trimmedBars, indicators: { ...trimmedHistorySeries, ...computeWindowRelativeIndicators(trimmedBars) } };
}

// '1day' deliberately reuses marketData.getHistorical's existing, shared daily cache (keyed by
// symbol alone in m_fmp_daily_cache, not by date range) rather than adding from/to params to its
// FMP call - that cache is also read by Momentum/Refresh Prices/Stock Preview/Contrarian
// Comeback/GET /quotes, and changing its query would change what's fetched/cached for all of
// them too. Instead, since getHistorical(symbol, apiKey, limit) already slices whatever's
// cached (up to 1000 bars) down to the caller's own requested limit, this just computes a bar
// count from the '1day' display+buffer calendar range (a ~5/7 trading-day ratio, +5 bar margin)
// and passes that as `limit` - reusing existing behavior exactly like every other caller.
function dailyBarLimit(): number {
  const { displayDays, bufferDays } = INTERVAL_RANGES['1day'];
  return Math.ceil((displayDays + bufferDays) * 5 / 7) + 5;
}

// The new intraday-only fetch helper (not shared with any other feature, so its FMP query is
// safe to bound freely) - from/to computed as today minus the interval's full display+buffer
// calendar range.
async function fetchIntradayBars(symbol: string, interval: CandlestickInterval, apiKey: string): Promise<CandlestickBar[]> {
  const { displayDays, bufferDays } = INTERVAL_RANGES[interval];
  const to = fmpDailyCache.getEasternDateString();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (displayDays + bufferDays));
  const from = fmpDailyCache.getEasternDateString(fromDate);
  const data = await marketData.fmpGet<unknown[]>(
    `${env.fmpBaseUrl}/historical-chart/${interval}?symbol=${symbol}&from=${from}&to=${to}&apikey=${apiKey}`,
    { timeoutMs: 15000 },
  );
  return data ? extractBars(data) : [];
}

// Read-only - never calls FMP. Backs the pop-up's instant-open and the "switching to an
// already-cached timeframe is free" behavior. Returns null if this (symbol, interval)
// combination has never been fetched at all - the caller shows a confirm-to-fetch prompt instead.
export async function getSnapshot(symbol: string, interval: CandlestickInterval): Promise<CandlestickSnapshot | null> {
  if (interval === '1day') {
    const cached = await fmpDailyCache.peekCached<unknown>(symbol, 'historical-price-eod');
    if (!cached) return null;
    const wideBars = extractBars(cached.data).slice(0, dailyBarLimit());
    const { bars, indicators } = buildDisplaySnapshot(wideBars, computeHistorySeries(wideBars), interval);
    return { bars, indicators, updatedAt: cached.updatedAt, isFresh: cached.wasCachedToday };
  }
  const cached = await fmpIntradayCache.getCached(symbol, interval);
  if (!cached) return null;
  const wideBars = cached.bars as CandlestickBar[];
  const wideHistorySeries = isValidHistorySeries(cached.indicators) ? cached.indicators : computeHistorySeries(wideBars);
  const { bars, indicators } = buildDisplaySnapshot(wideBars, wideHistorySeries, interval);
  return { bars, indicators, updatedAt: cached.updatedAt, isFresh: cached.isFresh };
}

// The explicit, confirmed action - the only path that ever makes a real FMP call for this
// feature. Checks the rate limit first; throws CandlestickRateLimitExceededError if it's
// exhausted, which the controller maps to 429.
export async function refresh(symbol: string, interval: CandlestickInterval, userId: string): Promise<CandlestickSnapshot> {
  const rateLimit = await checkCandlestickRateLimit(userId);
  if (!rateLimit.allowed) {
    throw new CandlestickRateLimitExceededError(
      `You've reached the limit of ${rateLimit.limit} new candlestick requests per ${rateLimit.windowMinutes} minutes. Please try again shortly.`,
    );
  }

  const apiKey = await userSubscription.getDecryptedKey(userId, 'fmp');
  let snapshot: CandlestickSnapshot;
  let realCalls: number;

  if (interval === '1day') {
    const result = await marketData.getHistorical(symbol, apiKey, dailyBarLimit());
    const wideBars = extractBars(result.bars);
    const peeked = await fmpDailyCache.peekCached<unknown>(symbol, 'historical-price-eod');
    const { bars, indicators } = buildDisplaySnapshot(wideBars, computeHistorySeries(wideBars), interval);
    snapshot = { bars, indicators, updatedAt: peeked?.updatedAt ?? new Date().toISOString(), isFresh: true };
    realCalls = result.realCalls;
  } else {
    const stored = await fmpIntradayCache.fetchAndStore(symbol, interval, async () => {
      const rawBars = await fetchIntradayBars(symbol, interval, apiKey);
      return { bars: rawBars, indicators: computeHistorySeries(rawBars) };
    });
    const { bars, indicators } = buildDisplaySnapshot(stored.bars as CandlestickBar[], stored.indicators, interval);
    snapshot = { bars, indicators, updatedAt: stored.updatedAt, isFresh: true };
    realCalls = 1;
  }

  usageTracking.logUsage(userId, 'stock_analysis_candlestick', { fmp_historical: realCalls })
    .catch((e) => console.error('usage log failed', e));

  return snapshot;
}

export interface CachedSymbolSummary {
  symbol: string;
  // Which interval produced the most recent pull - what the pop-up defaults to opening on, so
  // it doesn't have to guess/probe every interval to find one with data.
  interval: CandlestickInterval;
  updatedAt: string;
  isFresh: boolean;
}

// The left-panel list - one row per distinct symbol across both caches (intraday + the existing
// daily one), keeping only each symbol's single most-recently-updated row. DISTINCT ON picks
// that row (interval included, not just the max timestamp - a plain GROUP BY/MAX(updated_at)
// would lose which interval actually produced it) per symbol; the outer query re-sorts across
// symbols by recency and applies the display limit.
export async function listCachedSymbols(): Promise<CachedSymbolSummary[]> {
  const { rows } = await pool.query<{ symbol: string; time_interval: CandlestickInterval; updated_at: string }>(
    `SELECT symbol, time_interval, updated_at FROM (
       SELECT DISTINCT ON (symbol) symbol, time_interval, updated_at
       FROM (
         SELECT symbol, time_interval, updated_at FROM m_stock_ticker_candlestick_cache
         UNION ALL
         SELECT symbol, '1day' AS time_interval, updated_at FROM m_fmp_daily_cache WHERE api_name = 'historical-price-eod'
       ) combined
       ORDER BY symbol, updated_at DESC
     ) deduped
     ORDER BY updated_at DESC
     LIMIT 100`,
  );
  return rows.map((r) => ({
    symbol: r.symbol, interval: r.time_interval, updatedAt: r.updated_at,
    isFresh: fmpIntradayCache.deriveIsFresh(r.updated_at),
  }));
}
