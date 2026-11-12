// Shared, symbol+interval-keyed cache for candlestick OHLCV bars and their precomputed
// indicators (m_stock_ticker_candlestick_cache, migration 044). Mirrors fmpDailyCache.service.ts's
// shape (in-flight request coalescing, market-hours awareness), but with a time-based freshness
// rule instead of a calendar-day one - candlestick bars turn over far faster than most data
// fmpDailyCache.service.ts handles. Deliberately split into a read-only getCached() and a
// real-fetch fetchAndStore(), rather than one combined get-or-fetch function like
// fmpDailyCache.service.ts's own getOrFetch() - the Stock Analysis candlestick feature requires
// reads to always be free/instant while a real fetch always needs an explicit, confirmed,
// rate-limited caller (candlestick.service.ts), so the two need to be independently callable, not
// bundled into one function that decides for itself when to fetch.
//
// Agnostic to what "bars"/"indicators" actually contain (same genericity precedent as
// fmpDailyCache.service.ts's own `<T>` api_result) - this service only owns the cache/freshness
// mechanics; fetching real data and computing indicators is candlestick.service.ts's job.

import { pool } from '../db/pool';
import { isMarketOpenNow, getEasternDateString } from './fmpDailyCache.service';

// Priority backlog item (not built this phase): row deletion/retention here needs a nuanced,
// interval-aware policy to manage DB size - see migration 044's own header comment.

const FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

export interface CandlestickPayload {
  bars: unknown[];
  indicators: Record<string, unknown>;
}

export interface CachedCandlestickSnapshot extends CandlestickPayload {
  updatedAt: string;
  // While the market's open: fresh only if updated within the last 10 minutes. Once it's
  // closed, today's own data is treated as valid/frozen until the next session - same
  // freeze-after-close precedent fmpDailyCache.service.ts established for `quote` - but ONLY
  // if it was actually fetched earlier TODAY (Eastern calendar day), not any prior day.
  isFresh: boolean;
}

// Exported for candlestick.service.ts's listCachedSymbols(), which needs the same freshness rule
// applied to rows from a different table (m_fmp_daily_cache, for the '1day' interval).
//
// Real bug fixed 2026-11-09: this used to return `true` unconditionally whenever the market was
// closed, with no check at all on which day the row actually came from - confirmed live, INTC's
// '4hour' row sat 4 real calendar days stale (last pulled Nov 4, checked Nov 8) and still read
// `isFresh: true` purely because the market happened to be closed at check time. That silently
// hid the Refresh button too (CandlestickPopup.tsx only renders it when `!isFresh`), leaving no
// way to force an update. Now: "closed" means fresh only if the row was itself updated earlier
// TODAY - a row from any prior day (including last Friday, checked over a weekend) is treated
// as stale. That one weekend case trades a harmless extra Refresh click/FMP call (nothing new
// actually exists until Monday anyway) for never again silently hiding days of missed sessions
// behind a false "Fresh" badge - the same simple-over-cautious tradeoff this codebase already
// accepts elsewhere (e.g. isMarketOpenNow's own "no holiday calendar" choice).
export function deriveIsFresh(updatedAt: string): boolean {
  if (isMarketOpenNow()) {
    return Date.now() - new Date(updatedAt).getTime() < FRESHNESS_WINDOW_MS;
  }
  return getEasternDateString(new Date(updatedAt)) === getEasternDateString();
}

// Read-only - never calls FMP. Returns null if this (symbol, interval) has never been cached.
export async function getCached(symbol: string, interval: string): Promise<CachedCandlestickSnapshot | null> {
  const { rows } = await pool.query<{ bars: unknown[]; indicators: Record<string, unknown>; updated_at: string }>(
    'SELECT bars, indicators, updated_at FROM m_stock_ticker_candlestick_cache WHERE symbol = $1 AND time_interval = $2',
    [symbol, interval],
  );
  const row = rows[0];
  if (!row) return null;
  return { bars: row.bars, indicators: row.indicators, updatedAt: row.updated_at, isFresh: deriveIsFresh(row.updated_at) };
}

// Same in-flight-coalescing pattern as fmpDailyCache.service.ts's getOrFetch() - two
// near-simultaneous refresh calls for the same (symbol, interval) share one real fetch rather
// than both paying for it. Always calls fetchFn() for real; the caller (candlestick.service.ts)
// is responsible for having already confirmed this is an allowed, rate-limit-checked action
// before calling this.
const inFlight = new Map<string, Promise<CachedCandlestickSnapshot>>();

export async function fetchAndStore(
  symbol: string,
  interval: string,
  fetchFn: () => Promise<CandlestickPayload>,
): Promise<CachedCandlestickSnapshot> {
  const key = `${symbol}:${interval}`;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<CachedCandlestickSnapshot> => {
    const payload = await fetchFn();
    const { rows } = await pool.query<{ updated_at: string }>(
      `INSERT INTO m_stock_ticker_candlestick_cache (symbol, time_interval, bars, indicators, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (symbol, time_interval)
       DO UPDATE SET bars = $3, indicators = $4, updated_at = now()
       RETURNING updated_at`,
      [symbol, interval, JSON.stringify(payload.bars), JSON.stringify(payload.indicators)],
    );
    return { bars: payload.bars, indicators: payload.indicators, updatedAt: rows[0].updated_at, isFresh: true };
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
