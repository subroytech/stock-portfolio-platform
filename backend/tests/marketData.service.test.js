const { fmpGet } = require('../src/services/marketData.service');

describe('fmpGet', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('HTTP 402 (plan-tier restriction) resolves to null, not an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 402, ok: false });
    const data = await fmpGet('https://example.test/quote');
    expect(data).toBeNull();
  });

  test('HTTP 401 throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 401, ok: false });
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('HTTP 403 throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 403, ok: false });
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('HTTP 429 throws a rate-limit error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 429, ok: false });
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/rate limit/);
  });

  test('a 200 response with an FMP "Error Message" body throws an invalid-key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve({ 'Error Message': 'Invalid API KEY.' }),
    });
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('any other non-OK status throws a generic HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500, ok: false, text: () => Promise.resolve('server error'),
    });
    await expect(fmpGet('https://example.test/quote')).rejects.toThrow(/HTTP 500/);
  });

  test('a normal 200 JSON response resolves with the parsed data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve([{ symbol: 'AAPL', price: 200 }]),
    });
    const data = await fmpGet('https://example.test/quote');
    expect(data).toEqual([{ symbol: 'AAPL', price: 200 }]);
  });
});
