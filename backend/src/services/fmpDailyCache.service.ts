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

// Weekday + at/after 9:30am America/New_York - deliberately NOT capped at market close (unlike
// isMarketOpenNow above), since this answers a different question: "has today's opening bell
// already rung," not "is the market open right now." Used by requireFreshAfterOpen below to spot
// a 'quote' row that was fetched before today's session started - it still necessarily reflects
// the PRIOR day's close at that point, since no new tick exists yet, but it gets tagged with
// today's cache_date all the same.
function isAtOrAfterTodaysOpen(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutesSinceMidnight = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  return minutesSinceMidnight >= 9 * 60 + 30;
}

// A same-day cache_date alone isn't sufficient for 'quote' lookups: a row fetched pre-market
// (e.g. 1:44am) still correctly reflects the PRIOR session's close at that moment (nothing
// fresher exists yet), but gets stamped with TODAY's cache_date all the same - left unchecked,
// that stale pre-open snapshot silently blocks every real fetch for the rest of the day, even
// long after today's own close has genuinely happened. Confirmed live 2026-11-06: NVDA's cached
// quote was actually Thursday's 4:00pm close, tagged as Friday's data, because nobody refreshed
// during Friday's own 9:30-4:00 window. Scoped to 'quote' only (via requireFreshAfterOpen, set
// by getQuotes() alone) - every other cached api_name (profile, historical-price-eod, grades,
// ...) is fine with "whatever was true earlier today" and doesn't need this extra check.
function isCacheRowFreshEnough(updatedAt: string, requireFreshAfterOpen: boolean | undefined): boolean {
  if (!requireFreshAfterOpen) return true;
  const now = new Date();
  if (!isAtOrAfterTodaysOpen(now)) return true; // nothing fresher could exist yet today anyway
  return isAtOrAfterTodaysOpen(new Date(updatedAt));
}

interface GetOrFetchOptions {
  // Set true for calls that must stay live during market hours (quote) - skips the cache-date
  // check for reading, but the result still gets written through afterward so the next
  // after-hours lookup benefits immediately.
  forceFresh?: boolean;
  // Set true for 'quote' lookups only - see isCacheRowFreshEnough above.
  requireFreshAfterOpen?: boolean;
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
      const { rows } = await pool.query<{ api_result: T; cache_date: string; updated_at: string }>(
        'SELECT api_result, cache_date::text, updated_at FROM m_fmp_daily_cache WHERE symbol = $1 AND api_name = $2',
        [symbol, apiName],
      );
      const row = rows[0];
      if (row && row.cache_date === today && isCacheRowFreshEnough(row.updated_at, opts.requireFreshAfterOpen)) {
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

export interface PeekResult<T> {
  data: T;
  updatedAt: string;
  wasCachedToday: boolean;
}

// Read-only - never calls FMP, unlike getOrFetch above. Added for the Stock Analysis candlestick
// feature's '1day' path (candlestick.service.ts), which needs the "read without triggering a
// fetch" half of getOrFetch's logic on its own - a real fetch there only ever happens through an
// explicit, rate-limit-checked refresh action, never silently from a read.
export async function peekCached<T>(symbol: string, apiName: string): Promise<PeekResult<T> | null> {
  const { rows } = await pool.query<{ api_result: T; cache_date: string; updated_at: string }>(
    'SELECT api_result, cache_date::text, updated_at FROM m_fmp_daily_cache WHERE symbol = $1 AND api_name = $2',
    [symbol, apiName],
  );
  const row = rows[0];
  if (!row) return null;
  return { data: row.api_result, updatedAt: row.updated_at, wasCachedToday: row.cache_date === getEasternDateString() };
}
