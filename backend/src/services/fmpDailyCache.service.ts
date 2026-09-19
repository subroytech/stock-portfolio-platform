// Shared, symbol-level daily FMP cache (m_fmp_daily_cache, migration 042). Most FMP data used by
// Long-Term Analysis (and, in a later phase, Contrarian Comeback) is effectively static for a
// full US trading day - financials, peer lists, analyst ratings/targets/estimates, company
// identity fields. Keyed by (symbol, api_name), not per-user - this is pure market data,
// identical no matter who's asking, so the first lookup of a symbol on a given day pays the real
// FMP cost for its cacheable calls; every other lookup of that same symbol that same day pays
// nothing for them, for the rest of the day.

import { pool } from '../db/pool';

const EASTERN_TZ = 'America/New_York';

// YYYY-MM-DD in US-Eastern time, not UTC and not a rolling 24h window - matches when FMP's own
// underlying data actually turns over (end of the US trading session), not an arbitrary
// server-clock cutover mid-session. Intl.DateTimeFormat handles DST correctly with no manual
// offset math.
export function getEasternDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date); // en-CA formats as YYYY-MM-DD directly
}

// Weekday + regular US market hours (9:30-16:00 America/New_York) only - deliberately no holiday
// calendar. A market holiday landing on a weekday (e.g. Labor Day) is an accepted, harmless
// over-caution (treated as "market open" when it isn't), not a bug this needs to solve.
export function isMarketOpenNow(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
}

interface GetOrFetchOptions {
  // Set true for calls that must stay live during market hours (quote) - skips the cache-date
  // check for reading, but the result still gets written through afterward so the next
  // after-hours lookup benefits immediately.
  forceFresh?: boolean;
}

export interface GetOrFetchResult<T> {
  data: T;
  wasCached: boolean;
}

// Coalesces concurrent callers for the same (symbol, apiName): without this, two requests that
// both arrive before either one's write lands would both see a cache miss and both make a real,
// billed FMP call (found live via React StrictMode's dev-only double-mount, but the same race can
// hit in production too - e.g. two users looking up the same uncached symbol at once). Keyed
// process-wide, not per-request - `inFlight.get`/`.set` run synchronously with no `await` between
// them, so on Node's single-threaded event loop whichever call reaches this function first always
// wins the race deterministically.
const inFlight = new Map<string, Promise<GetOrFetchResult<unknown>>>();

export async function getOrFetch<T>(
  symbol: string,
  apiName: string,
  description: string,
  fetchFn: () => Promise<T>,
  opts: GetOrFetchOptions = {},
): Promise<GetOrFetchResult<T>> {
  const key = `${symbol}:${apiName}`;
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<GetOrFetchResult<T>>;
  }

  const promise = (async (): Promise<GetOrFetchResult<T>> => {
    const today = getEasternDateString();

    if (!opts.forceFresh) {
      const { rows } = await pool.query<{ api_result: T; cache_date: string }>(
        'SELECT api_result, cache_date::text FROM m_fmp_daily_cache WHERE symbol = $1 AND api_name = $2',
        [symbol, apiName],
      );
      const row = rows[0];
      if (row && row.cache_date === today) {
        return { data: row.api_result, wasCached: true };
      }
    }

    const data = await fetchFn();
    await pool.query(
      `INSERT INTO m_fmp_daily_cache (symbol, api_name, api_call_description, cache_date, api_result, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (symbol, api_name)
       DO UPDATE SET api_call_description = $3, cache_date = $4, api_result = $5, updated_at = now()`,
      [symbol, apiName, description, today, JSON.stringify(data)],
    );
    return { data, wasCached: false };
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
