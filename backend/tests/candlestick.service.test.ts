jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service', () => ({
  ...jest.requireActual('../src/services/marketData.service'),
  getHistorical: jest.fn(),
  fmpGet: jest.fn(),
}));
jest.mock('../src/services/fmpDailyCache.service', () => ({
  ...jest.requireActual('../src/services/fmpDailyCache.service'),
  peekCached: jest.fn(),
}));
jest.mock('../src/services/fmpIntradayCache.service', () => ({
  getCached: jest.fn(),
  fetchAndStore: jest.fn(),
  deriveIsFresh: jest.fn(),
}));
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service', () => ({ logUsage: jest.fn() }));
jest.mock('../src/services/candlestickRateLimit.service', () => ({ checkCandlestickRateLimit: jest.fn() }));

import { pool } from '../src/db/pool';
import * as marketData from '../src/services/marketData.service';
import * as fmpDailyCache from '../src/services/fmpDailyCache.service';
import * as fmpIntradayCache from '../src/services/fmpIntradayCache.service';
import * as userSubscription from '../src/services/userSubscription.service';
import * as usageTracking from '../src/services/usageTracking.service';
import { checkCandlestickRateLimit } from '../src/services/candlestickRateLimit.service';
import { getSnapshot, refresh, listCachedSymbols, INTERVAL_RANGES, CandlestickRateLimitExceededError } from '../src/services/candlestick.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetHistorical = marketData.getHistorical as jest.Mock;
const mockFmpGet = marketData.fmpGet as jest.Mock;
const mockPeekCached = fmpDailyCache.peekCached as jest.Mock;
const mockGetCached = fmpIntradayCache.getCached as jest.Mock;
const mockFetchAndStore = fmpIntradayCache.fetchAndStore as jest.Mock;
const mockDeriveIsFresh = fmpIntradayCache.deriveIsFresh as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockLogUsage = usageTracking.logUsage as jest.Mock;
const mockCheckRateLimit = checkCandlestickRateLimit as jest.Mock;

// A bar dated relative to "now" (not a hardcoded date) so display-window trimming (Phase 1.1)
// never accidentally filters it out regardless of when the test suite actually runs. Format
// matches FMP's real intraday bars ("YYYY-MM-DD HH:mm:ss").
function barHoursAgo(hoursAgo: number, overrides: Partial<Record<string, string>> = {}) {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return { date, open: '10', high: '12', low: '9', close: '11', volume: '1000', ...overrides };
}
const RAW_BAR = barHoursAgo(1); // safely within every interval's (much larger) display window

// The intraday cache (m_stock_ticker_candlestick_cache) always stores bars AFTER extractBars()
// has already parsed them to numbers (fetchIntradayBars runs extractBars before fmpIntradayCache
// ever sees them) - fmpIntradayCache.getCached()/fetchAndStore() mocks below must reflect that
// already-numeric shape, unlike RAW_BAR above (which represents FMP's own raw string response,
// used only where a test mocks marketData.fmpGet/getHistorical directly).
function numericBarHoursAgo(hoursAgo: number, overrides: Partial<Record<string, number>> = {}) {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return { date, open: 10, high: 12, low: 9, close: 11, volume: 1000, ...overrides };
}
const NUMERIC_BAR = numericBarHoursAgo(1);

beforeEach(() => {
  jest.clearAllMocks();
  mockLogUsage.mockResolvedValue(undefined);
});

describe('getSnapshot', () => {
  test('1day - reads from the existing daily cache (peekCached), never fetches, computes indicators', async () => {
    mockPeekCached.mockResolvedValueOnce({ data: [RAW_BAR, RAW_BAR], updatedAt: '2026-09-17T20:00:00Z', wasCachedToday: true });

    const result = await getSnapshot('AAPL', '1day');

    expect(mockPeekCached).toHaveBeenCalledWith('AAPL', 'historical-price-eod');
    expect(mockGetHistorical).not.toHaveBeenCalled();
    expect(result?.bars).toHaveLength(2);
    expect(result?.bars[0]).toEqual({ date: RAW_BAR.date, open: 10, high: 12, low: 9, close: 11, volume: 1000 });
    expect(result?.updatedAt).toBe('2026-09-17T20:00:00Z');
    expect(result?.isFresh).toBe(true);
    expect(result?.indicators).toHaveProperty('vwap');
    expect(result?.indicators).toHaveProperty('pivotPoints');
    expect(result?.indicators).toHaveProperty('fibonacci');
  });

  test('1day - null when nothing cached yet', async () => {
    mockPeekCached.mockResolvedValueOnce(null);
    expect(await getSnapshot('AAPL', '1day')).toBeNull();
  });

  test('intraday - reads from fmpIntradayCache.getCached, never fetches', async () => {
    mockGetCached.mockResolvedValueOnce({ bars: [NUMERIC_BAR], indicators: { sma20: [null] }, updatedAt: 'x', isFresh: false });

    const result = await getSnapshot('AAPL', '5min');

    expect(mockGetCached).toHaveBeenCalledWith('AAPL', '5min');
    expect(mockFmpGet).not.toHaveBeenCalled();
    expect(result?.bars).toEqual([NUMERIC_BAR]);
    expect(result?.updatedAt).toBe('x');
    expect(result?.isFresh).toBe(false);
  });

  test('intraday - null when nothing cached yet', async () => {
    mockGetCached.mockResolvedValueOnce(null);
    expect(await getSnapshot('AAPL', '5min')).toBeNull();
  });

  test('self-heals a cache row written before Phase 1.1\'s series shape existed (the real bug found live 2026-09-18: a stale row\'s sma20/macd/etc. as bare values, not arrays, crashed the frontend) by recomputing from the cached bars instead of passing the stale shape through', async () => {
    const bars = [numericBarHoursAgo(1, { close: 11 }), numericBarHoursAgo(2, { close: 10 })];
    mockGetCached.mockResolvedValueOnce({
      bars,
      // Old single-value/single-object shape (momentum.service.ts's own single-snapshot style),
      // not the per-bar arrays Phase 1.1 requires.
      indicators: { sma20: 10.5, sma50: 10.5, ema20: 10.5, rsi14: 55, macd: { macd: 1, signal: 1, hist: 0 }, bb20: { upper: 11, mid: 10.5, lower: 10, bw: 0.1 } },
      updatedAt: 'x',
      isFresh: true,
    });

    const result = await getSnapshot('AAPL', '5min');

    expect(Array.isArray(result?.indicators.sma20)).toBe(true);
    expect(Array.isArray(result?.indicators.sma50)).toBe(true);
    expect(Array.isArray(result?.indicators.rsi14)).toBe(true);
    expect(Array.isArray(result?.indicators.macd)).toBe(true);
    expect(Array.isArray(result?.indicators.bb20)).toBe(true);
    expect(result?.bars).toHaveLength(2);
  });

  test('Phase 1.1 - trims bars older than the interval\'s display window out of the response, keeping them out of window-relative indicators too', async () => {
    const recent = numericBarHoursAgo(2, { close: 50 }); // well within 5min's 3-day display window
    const old = numericBarHoursAgo(240, { close: 999 }); // 10 days old - outside 5min's 3-day display window
    mockGetCached.mockResolvedValueOnce({
      bars: [recent, old],
      indicators: { sma20: [1, 2], sma50: [3, 4], ema20: [5, 6], rsi14: [7, 8], macd: [{ macd: 1, signal: 1, hist: 0 }, { macd: 2, signal: 2, hist: 0 }], bb20: [{ upper: 1, mid: 1, lower: 1, bw: 0 }, { upper: 2, mid: 2, lower: 2, bw: 0 }] },
      updatedAt: 'x',
      isFresh: true,
    });

    const result = await getSnapshot('AAPL', '5min');

    // The old bar (and its parallel index in every history-dependent series) is gone.
    expect(result?.bars).toHaveLength(1);
    expect(result?.bars[0].close).toBe(50);
    expect(result?.indicators.sma20).toEqual([1]);
    expect(result?.indicators.sma50).toEqual([3]);
    expect(result?.indicators.rsi14).toEqual([7]);
    // Window-relative indicators are recomputed fresh from just the trimmed bar, not the wide set
    // - a single-bar VWAP equals that bar's own typical price ((12+9+50)/3 = 23.67).
    expect((result?.indicators.vwap as number[])[0]).toBeCloseTo((12 + 9 + 50) / 3);
  });

  test('Phase 1.1 - 1day computes history series over the wide (buffered) bars before trimming to the display window', async () => {
    // 300 bars, oldest is 300 days back - beyond 1day's 224-day display window (into, and even
    // past, its buffer), so the oldest ones should still count toward sma50's lookback even
    // though they're not returned.
    const bars = Array.from({ length: 300 }, (_, i) => barHoursAgo(i * 24, { close: String(400 - i) }));
    mockPeekCached.mockResolvedValueOnce({ data: bars, updatedAt: 'x', wasCachedToday: true });

    const result = await getSnapshot('AAPL', '1day');

    expect(result?.bars.length).toBeLessThan(300); // trimmed to the display window
    expect(result?.bars.length).toBeGreaterThan(0);
    // sma50 should be non-null for the returned (display-window) bars - proving it was computed
    // over the full 65-bar wide set, not just whatever survived trimming.
    expect((result?.indicators.sma50 as (number | null)[])[0]).not.toBeNull();
  });
});

describe('refresh', () => {
  test('throws CandlestickRateLimitExceededError and never fetches when the limit is exhausted', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, limit: 10, windowMinutes: 10, usedInWindow: 10 });

    await expect(refresh('AAPL', '5min', 'u1')).rejects.toThrow(CandlestickRateLimitExceededError);
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
    expect(mockLogUsage).not.toHaveBeenCalled();
  });

  test('1day - fetches via the existing daily path with a computed bar limit, logs realCalls, re-peeks for the true updatedAt', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, limit: 10, windowMinutes: 10, usedInWindow: 0 });
    mockGetDecryptedKey.mockResolvedValueOnce('fmp-key');
    mockGetHistorical.mockResolvedValueOnce({ bars: [RAW_BAR], realCalls: 1 });
    mockPeekCached.mockResolvedValueOnce({ data: [RAW_BAR], updatedAt: '2026-09-18T00:00:00Z', wasCachedToday: true });

    const result = await refresh('AAPL', '1day', 'u1');

    // Never a hardcoded 260 anymore - computed from INTERVAL_RANGES['1day']'s display+buffer.
    const expectedLimit = Math.ceil((INTERVAL_RANGES['1day'].displayDays + INTERVAL_RANGES['1day'].bufferDays) * 5 / 7) + 5;
    expect(mockGetHistorical).toHaveBeenCalledWith('AAPL', 'fmp-key', expectedLimit);
    expect(result.updatedAt).toBe('2026-09-18T00:00:00Z');
    expect(result.isFresh).toBe(true);
    expect(mockLogUsage).toHaveBeenCalledWith('u1', 'stock_analysis_candlestick', { fmp_historical: 1 });
  });

  test('intraday - delegates the real fetch+cache-write to fmpIntradayCache.fetchAndStore, logs realCalls: 1', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, limit: 10, windowMinutes: 10, usedInWindow: 3 });
    mockGetDecryptedKey.mockResolvedValueOnce('fmp-key');
    mockFetchAndStore.mockResolvedValueOnce({ bars: [NUMERIC_BAR], indicators: { sma20: [1] }, updatedAt: 'x', isFresh: true });

    const result = await refresh('AAPL', '5min', 'u1');

    expect(mockFetchAndStore).toHaveBeenCalledWith('AAPL', '5min', expect.any(Function));
    expect(result.bars).toEqual([NUMERIC_BAR]);
    expect(result.indicators.sma20).toEqual([1]);
    expect(mockLogUsage).toHaveBeenCalledWith('u1', 'stock_analysis_candlestick', { fmp_historical: 1 });
  });

  test('intraday - the fetchAndStore closure fetches FMP\'s historical-chart endpoint with a from/to range and returns bars+history-series', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, limit: 10, windowMinutes: 10, usedInWindow: 0 });
    mockGetDecryptedKey.mockResolvedValueOnce('fmp-key');
    mockFmpGet.mockResolvedValueOnce([RAW_BAR]);
    mockFetchAndStore.mockImplementationOnce(async (_symbol: string, _interval: string, fetchFn: () => Promise<unknown>) => {
      const payload = await fetchFn();
      return { ...(payload as object), updatedAt: 'x', isFresh: true };
    });

    const result = await refresh('AAPL', '15min', 'u1');

    const [url] = mockFmpGet.mock.calls[0];
    expect(url).toContain('/historical-chart/15min');
    expect(url).toContain('symbol=AAPL');
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}/);
    expect(result.bars).toHaveLength(1);
    expect(result.indicators).toHaveProperty('sma20');
  });
});

describe('listCachedSymbols', () => {
  test('queries a union of the intraday and daily caches, LIMIT 100, and derives freshness per row', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ symbol: 'AAPL', time_interval: '5min', updated_at: 'x' }, { symbol: 'TSLA', time_interval: '1day', updated_at: 'y' }],
    });
    mockDeriveIsFresh.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const result = await listCachedSymbols();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('DISTINCT ON (symbol)');
    expect(sql).toContain('m_stock_ticker_candlestick_cache');
    expect(sql).toContain("m_fmp_daily_cache WHERE api_name = 'historical-price-eod'");
    expect(sql).toContain('LIMIT 100');
    expect(result).toEqual([
      { symbol: 'AAPL', interval: '5min', updatedAt: 'x', isFresh: true },
      { symbol: 'TSLA', interval: '1day', updatedAt: 'y', isFresh: false },
    ]);
  });
});
