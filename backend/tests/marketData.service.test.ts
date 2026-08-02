import { fmpGet, getProfiles } from '../src/services/marketData.service';

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
