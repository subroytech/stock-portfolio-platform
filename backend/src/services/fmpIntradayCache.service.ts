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
import { isMarketOpenNow } from './fmpDailyCache.service';

// Priority backlog item (not built this phase): row deletion/retention here needs a nuanced,
// interval-aware policy to manage DB size - see migration 044's own header comment.

const FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

export interface CandlestickPayload {
  bars: unknown[];
  indicators: Record<string, unknown>;
}

export interface CachedCandlestickSnapshot extends CandlestickPayload {
  updatedAt: string;
  // While the market's open: fresh only if updated within the last 10 minutes. Once it's closed,
  // whatever's cached is treated as still valid/frozen until the next session's first fetch -
  // same freeze-after-close precedent fmpDailyCache.service.ts already established for `quote`.
  isFresh: boolean;
}

// Exported for candlestick.service.ts's listCachedSymbols(), which needs the same freshness rule
// applied to rows from a different table (m_fmp_daily_cache, for the '1day' interval).
export function deriveIsFresh(updatedAt: string): boolean {
  if (!isMarketOpenNow()) return true;
  return Date.now() - new Date(updatedAt).getTime() < FRESHNESS_WINDOW_MS;
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
