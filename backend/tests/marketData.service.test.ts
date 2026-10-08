// The auto-mock below still loads the real fmpDailyCache.service.ts to introspect its shape,
// which imports the real ../db/pool - that throws at module-load time when DATABASE_URL isn't
// set (CI's backend job never sets it, by design - unit tests shouldn't need a real DB). Mocking
// pool directly here is what makes that load safe.
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/fmpDailyCache.service');

import { fmpGet, getProfiles, getQuotes, getHistorical } from '../src/services/marketData.service';
import * as fmpDailyCache from '../src/services/fmpDailyCache.service';

const mockGetOrFetch = fmpDailyCache.getOrFetch as jest.Mock;
const mockIsMarketOpenNow = fmpDailyCache.isMarketOpenNow as jest.Mock;

describe('fmpGet', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('HTTP 402 (plan-tier restriction) resolves to null, not an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 402, ok: false }) as unknown as typeof fetch;
    const data = await fmpGet('https://example.test/quote');
    expect(data).toBeNull();
  });

  test('HTTP 401 throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('HTTP 403 throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 403, ok: false }) as unknown as typeof fetch;
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('HTTP 429 throws a rate-limit error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 429, ok: false }) as unknown as typeof fetch;
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/rate limit/);
  });

  test('a 200 response with an FMP "Error Message" body throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve({ 'Error Message': 'Invalid API KEY.' }),
    }) as unknown as typeof fetch;
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('any other non-OK status throws a generic HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500, ok: false, text: () => Promise.resolve('server error'),
    }) as unknown as typeof fetch;
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/HTTP 500/);
  });

  test('a normal 200 JSON response resolves with the parsed data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve([{ symbol: 'AAPL', price: 200 }]),
    }) as unknown as typeof fetch;
    const data = await fmpGet('https://example.test/quote');
    expect(data).toEqual([{ symbol: 'AAPL', price: 200 }]);
  });
});

describe('getProfiles', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  // /profile returns companyName+sector+marketCap in one call per symbol,
  // unlike /quote (used for backfillTickerData.ts/refreshTickerDataBatch() -
  // see marketData.service.ts's comment on why /profile was chosen over
  // /quote for this).
  test('maps companyName/sector/marketCap from each symbol\'s /profile response', async () => {
    global.fetch = jest.fn((url: string) => {
      const symbol = new URL(url).searchParams.get('symbol');
      const body = symbol === 'AAPL'
        ? [{ companyName: 'Apple Inc.', sector: 'Technology', marketCap: 3000000000000 }]
        : [{ companyName: 'Microsoft Corporation', sector: 'Technology', marketCap: 2500000000000 }];
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;

    const result = await getProfiles(['AAPL', 'MSFT'], 'fake-key');
    expect(result).toEqual({
      AAPL: { name: 'Apple Inc.', sector: 'Technology', marketCap: 3000000000000 },
      MSFT: { name: 'Microsoft Corporation', sector: 'Technology', marketCap: 2500000000000 },
    });
  });

  test('a profile response missing marketCap resolves it to null, not undefined/dropped', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve([{ companyName: 'Apple Inc.', sector: 'Technology' }]),
    }) as unknown as typeof fetch;

    const result = await getProfiles(['AAPL'], 'fake-key');
    expect(result.AAPL).toEqual({ name: 'Apple Inc.', sector: 'Technology', marketCap: null });
  });

  test('a symbol with no profile data (null/empty response) is simply absent from the result map', async () => {
    global.fetch = jest.fn((url: string) => {
      const symbol = new URL(url).searchParams.get('symbol');
      const body = symbol === 'AAPL' ? [{ companyName: 'Apple Inc.', sector: 'Technology', marketCap: 3000000000000 }] : [];
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;

    const result = await getProfiles(['AAPL', 'ZZZ'], 'fake-key');
    expect(result).toEqual({ AAPL: { name: 'Apple Inc.', sector: 'Technology', marketCap: 3000000000000 } });
    expect(result.ZZZ).toBeUndefined();
  });

  test('a 401 from FMP throws an invalid-key error, same as getQuotes', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false }) as unknown as typeof fetch;
    await expect(getProfiles(['AAPL'], 'bad-key')).rejects.toThrow(/Invalid or expired FMP API key/);
  });
});

// getQuotes()/getHistorical() route through the shared daily FMP cache (fmpDailyCache.service.ts,
// 2026-09-12) - fmpDailyCache.getOrFetch()'s own caching mechanics are covered by its own test
// file, so these tests mock it directly and focus on: what args getQuotes/getHistorical pass to
// it, how they parse whatever getOrFetch resolves with, and how they report realCalls.
describe('getQuotes', () => {
  beforeEach(() => {
    mockGetOrFetch.mockReset();
    mockIsMarketOpenNow.mockReset().mockReturnValue(true);
  });

  test('routes each symbol through the shared cache keyed by "quote", with forceFresh reflecting isMarketOpenNow()', async () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    mockGetOrFetch.mockResolvedValue({ data: null, wasCached: false });
    await getQuotes(['AAPL', 'MSFT'], 'fake-key');
    expect(mockGetOrFetch).toHaveBeenCalledWith('AAPL', 'quote', expect.any(String), expect.any(Function), { forceFresh: true });
    expect(mockGetOrFetch).toHaveBeenCalledWith('MSFT', 'quote', expect.any(String), expect.any(Function), { forceFresh: true });
  });

  test('forceFresh is false once the market is closed, letting a same-day cache hit apply', async () => {
    mockIsMarketOpenNow.mockReturnValue(false);
    mockGetOrFetch.mockResolvedValue({ data: null, wasCached: true });
    await getQuotes(['AAPL'], 'fake-key');
    expect(mockGetOrFetch).toHaveBeenCalledWith('AAPL', 'quote', expect.any(String), expect.any(Function), { forceFresh: false });
  });

  test('parses a raw FMP quote array (whatever fmpDailyCache resolved with) into a normalized Quote', async () => {
    mockGetOrFetch.mockResolvedValue({
      data: [{ symbol: 'AAPL', price: '110', change: '10', changesPercentage: '99', name: 'Apple Inc.', isActivelyTrading: true }],
      wasCached: false,
    });
    const result = await getQuotes(['AAPL'], 'fake-key');
    expect(result.quotes.AAPL).toEqual({ price: 110, changeDollar: 10, changePercent: 10, name: 'Apple Inc.', isActivelyTrading: true });
  });

  test('realCalls counts only the symbols not served from cache', async () => {
    mockGetOrFetch.mockImplementation((sym: string) => Promise.resolve({
      data: [{ price: '100', name: sym }],
      wasCached: sym === 'CACHED',
    }));
    const result = await getQuotes(['FRESH', 'CACHED'], 'fake-key');
    expect(result.realCalls).toBe(1);
  });

  test('a rejected getOrFetch call counts as 1 real call - a cache hit can never reach a rejection', async () => {
    mockGetOrFetch
      .mockResolvedValueOnce({ data: [{ price: '100', name: 'A' }], wasCached: true })
      .mockRejectedValueOnce(new Error('network blip'));
    const result = await getQuotes(['CACHED', 'FAILED'], 'fake-key');
    expect(result.realCalls).toBe(1);
  });

  test('a symbol with no price data is simply absent from the result map', async () => {
    mockGetOrFetch.mockResolvedValue({ data: null, wasCached: false });
    const result = await getQuotes(['ZZZ'], 'fake-key');
    expect(result.quotes.ZZZ).toBeUndefined();
  });

  test('propagates an invalid-key rejection reason as a clear error', async () => {
    mockGetOrFetch.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    await expect(getQuotes(['AAPL'], 'bad-key')).rejects.toThrow(/Invalid or expired FMP API key/);
  });
});

describe('getHistorical', () => {
  beforeEach(() => mockGetOrFetch.mockReset());

  test('always requests the shared cache limit (1000) internally, regardless of the caller\'s own smaller limit', async () => {
    mockGetOrFetch.mockResolvedValue({ data: [], wasCached: false });
    await getHistorical('AAPL', 'fake-key', 130);
    const [, , description] = mockGetOrFetch.mock.calls[0];
    expect(description).toContain('limit=1000');
  });

  test('slices the cached/fetched array down to the caller\'s requested limit - the most recent N, since FMP returns newest-first', async () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ date: `day-${i}`, close: i }));
    mockGetOrFetch.mockResolvedValue({ data: bars, wasCached: false });
    const result = await getHistorical('AAPL', 'fake-key', 3);
    expect(result.bars).toEqual(bars.slice(0, 3));
  });

  test('handles the {historical: [...]} wrapped response shape, not just a bare array', async () => {
    mockGetOrFetch.mockResolvedValue({ data: { historical: [{ date: 'day-0', close: 1 }] }, wasCached: false });
    const result = await getHistorical('AAPL', 'fake-key', 10);
    expect(result.bars).toEqual([{ date: 'day-0', close: 1 }]);
  });

  test('realCalls is 0 on a cache hit, 1 on a real fetch', async () => {
    mockGetOrFetch.mockResolvedValueOnce({ data: [], wasCached: true });
    expect((await getHistorical('AAPL', 'fake-key')).realCalls).toBe(0);

    mockGetOrFetch.mockResolvedValueOnce({ data: [], wasCached: false });
    expect((await getHistorical('MSFT', 'fake-key')).realCalls).toBe(1);
  });

  test('propagates a rejection from the underlying fetch (e.g. invalid key)', async () => {
    mockGetOrFetch.mockRejectedValue(new Error('Invalid or expired FMP API key.'));
    await expect(getHistorical('AAPL', 'bad-key')).rejects.toThrow(/Invalid or expired FMP API key/);
  });
});
