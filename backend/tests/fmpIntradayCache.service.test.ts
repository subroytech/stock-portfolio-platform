jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/fmpDailyCache.service', () => ({
  ...jest.requireActual('../src/services/fmpDailyCache.service'),
  isMarketOpenNow: jest.fn(),
}));

import { pool } from '../src/db/pool';
import { isMarketOpenNow } from '../src/services/fmpDailyCache.service';
import { getCached, fetchAndStore, deriveIsFresh } from '../src/services/fmpIntradayCache.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockIsMarketOpenNow = isMarketOpenNow as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockIsMarketOpenNow.mockReset();
});

describe('getCached', () => {
  test('null when no row exists - never calls FMP', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getCached('AAPL', '5min')).toBeNull();
  });

  test('scoped by both symbol and time_interval', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getCached('AAPL', '5min');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE symbol = $1 AND time_interval = $2');
    expect(params).toEqual(['AAPL', '5min']);
  });

  test('market open + updated under 10 minutes ago - fresh', async () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{ bars: [{ close: 1 }], indicators: { sma20: 1 }, updated_at: updatedAt }] });
    const result = await getCached('AAPL', '5min');
    expect(result).toEqual({ bars: [{ close: 1 }], indicators: { sma20: 1 }, updatedAt, isFresh: true });
  });

  test('market open + updated over 10 minutes ago - stale', async () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    const updatedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{ bars: [], indicators: {}, updated_at: updatedAt }] });
    const result = await getCached('AAPL', '5min');
    expect(result?.isFresh).toBe(false);
  });

  test('market closed - always treated as fresh (frozen) regardless of age', async () => {
    mockIsMarketOpenNow.mockReturnValue(false);
    const updatedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5 hours old
    mockQuery.mockResolvedValueOnce({ rows: [{ bars: [], indicators: {}, updated_at: updatedAt }] });
    const result = await getCached('AAPL', '5min');
    expect(result?.isFresh).toBe(true);
  });
});

describe('deriveIsFresh', () => {
  test('mirrors getCached\'s own freshness rule for external callers', () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    expect(deriveIsFresh(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(deriveIsFresh(new Date(Date.now() - 11 * 60 * 1000).toISOString())).toBe(false);
  });
});

describe('fetchAndStore', () => {
  test('always calls fetchFn and upserts, returning isFresh: true', async () => {
    const updatedAt = new Date().toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{ updated_at: updatedAt }] });
    const fetchFn = jest.fn().mockResolvedValue({ bars: [{ close: 100 }], indicators: { sma20: 100 } });

    const result = await fetchAndStore('AAPL', '5min', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ bars: [{ close: 100 }], indicators: { sma20: 100 }, updatedAt, isFresh: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO m_stock_ticker_candlestick_cache');
    expect(sql).toContain('ON CONFLICT (symbol, time_interval)');
    expect(params).toEqual(['AAPL', '5min', JSON.stringify([{ close: 100 }]), JSON.stringify({ sma20: 100 })]);
  });

  test('two concurrent calls for the same symbol+interval coalesce into a single fetchFn call', async () => {
    // Controls fetchFn's own resolution (not pool.query's) - this is what proves coalescing
    // happens at the right layer, since both calls must be in flight while fetchFn is still
    // pending for the second one to actually find and reuse the first's in-flight promise.
    let resolveFetch!: (v: { bars: unknown[]; indicators: Record<string, unknown> }) => void;
    const fetchFn = jest.fn().mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    mockQuery.mockResolvedValue({ rows: [{ updated_at: 'x' }] });

    const call1 = fetchAndStore('AAPL', '5min', fetchFn);
    const call2 = fetchAndStore('AAPL', '5min', fetchFn);
    resolveFetch({ bars: [], indicators: {} });

    const [result1, result2] = await Promise.all([call1, call2]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result2).toEqual(result1);
  });

  test('different intervals for the same symbol do not coalesce', async () => {
    mockQuery.mockResolvedValue({ rows: [{ updated_at: 'x' }] });
    const fetchFn = jest.fn().mockResolvedValue({ bars: [], indicators: {} });

    await Promise.all([
      fetchAndStore('AAPL', '5min', fetchFn),
      fetchAndStore('AAPL', '15min', fetchFn),
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
