import { fetchLongTermAnalysisData } from '../src/services/longTermAnalysisData.service';

function jsonResponse(body: unknown, status = 200) {
  return { status, ok: status < 300, json: () => Promise.resolve(body) };
}

// Routes global.fetch calls to canned responses by matching a substring in
// the URL — lets one test set up all the endpoints this service calls
// without caring about exact query-param ordering.
function mockFetchByUrl(routes: Record<string, unknown>) {
  global.fetch = jest.fn((url: string) => {
    for (const [match, body] of Object.entries(routes)) {
      if (url.includes(match)) return Promise.resolve(jsonResponse(body));
    }
    return Promise.resolve(jsonResponse([]));
  }) as unknown as typeof fetch;
}

const CRITICAL_HAPPY_ROUTES = {
  '/profile?': [{ companyName: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ', marketCap: 3e12, beta: 1.2, range: '150-220', lastDividend: 1, price: 199 }],
  '/quote?symbol=AAPL': [{ price: 200, pe: 28 }],
  '/income-statement?': [
    { fiscalYear: '2026', revenue: 1100, grossProfit: 550, operatingIncome: 220, netIncome: 200, eps: 6.1 },
    { fiscalYear: '2025', revenue: 1000, grossProfit: 500, operatingIncome: 200, netIncome: 150, eps: 5.0 },
  ],
  '/earnings?': [{ date: '2026-06-30', epsActual: 1.6, epsEstimated: 1.5 }],
  '/price-target-consensus?': [{ targetConsensus: 230, targetHigh: 260, targetLow: 190 }],
  '/grades?': [
    { gradingCompany: 'Firm A', newGrade: 'Buy', date: '2026-01-01' },
    { gradingCompany: 'Firm A', newGrade: 'Hold', date: '2026-03-01' }, // newer — bucketing (later) should prefer this one
  ],
};

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe('fetchLongTermAnalysisData', () => {
  test('happy path assembles the full payload', async () => {
    mockFetchByUrl({
      ...CRITICAL_HAPPY_ROUTES,
      // /stable/stock-peers returns the peer list as a flat array of peer
      // objects directly — confirmed against a live account 2026-07-26 —
      // not wrapped in {peersList: [...]}.
      '/stock-peers?': [{ symbol: 'MSFT', companyName: 'Microsoft Corporation', price: 400, mktCap: 3e12 }],
      // (this array IS the peer list itself; only `symbol` is read from it —
      // price/pe/evToEbitda for peers still come from the separate /quote
      // and /key-metrics calls per peer symbol below)
      '/quote?symbol=MSFT': [{ price: 400, marketCap: 3e12 }],
      '/key-metrics?symbol=AAPL': [{ evToEBITDA: 22, earningsYield: 0.025 }],
      // earningsYield 0.05 -> trailingPe 20 (1 / 0.05) — /stable/quote has no
      // `pe` field, so peer P/E is derived from key-metrics' earningsYield.
      '/key-metrics?symbol=MSFT': [{ evToEBITDA: 20, earningsYield: 0.05 }],
      '/financial-estimates?': [{ date: `${new Date().getFullYear() + 1}-12-31`, epsAvg: 6.5 }],
    });

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', 'fake-finnhub-key');

    expect(data.symbol).toBe('AAPL');
    expect(data.companyName).toBe('Apple Inc.');
    expect(data.price).toBe(200); // quote.price preferred over profile.price
    expect(data.incomeStatements).toHaveLength(2);
    expect(data.peers).toEqual([{ symbol: 'MSFT', price: 400, trailingPe: 20, evToEbitda: 20, marketCap: 3e12 }]);
    expect(data.forwardEpsEstimate).toBe(6.5);
    expect(data.evToEbitda).toBe(22);
    // Grades are passed through raw and undeduplicated — bucketing is Python's job.
    expect(data.grades).toHaveLength(2);
  });

  test('non-critical peer/forward-EPS/EV-EBITDA/news failures degrade gracefully, not thrown', async () => {
    global.fetch = jest.fn((url: string) => {
      for (const [match, body] of Object.entries(CRITICAL_HAPPY_ROUTES)) {
        if (url.includes(match)) return Promise.resolve(jsonResponse(body));
      }
      return Promise.reject(new Error('simulated non-critical failure'));
    }) as unknown as typeof fetch;

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', 'fake-finnhub-key');

    expect(data.peers).toEqual([]);
    expect(data.forwardEpsEstimate).toBeNull();
    expect(data.evToEbitda).toBeNull();
    expect(data.news).toEqual([]);
  });

  test('no Finnhub key provided means news stays empty without any Finnhub call', async () => {
    mockFetchByUrl(CRITICAL_HAPPY_ROUTES);
    const fetchSpy = global.fetch as jest.Mock;

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', undefined);

    expect(data.news).toEqual([]);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('finnhub'))).toBe(false);
  });

  test('a critical call rejecting (e.g. invalid FMP key) propagates the error', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/profile?')) return Promise.resolve({ status: 401, ok: false });
      return Promise.resolve(jsonResponse([]));
    }) as unknown as typeof fetch;

    await expect(fetchLongTermAnalysisData('AAPL', 'bad-key')).rejects.toThrow(/Invalid or expired FMP API key/);
  });

  test('missing profile or quote throws a clear "no data" error', async () => {
    mockFetchByUrl({}); // every endpoint resolves to []
    await expect(fetchLongTermAnalysisData('ZZZZ', 'fake-fmp-key')).rejects.toThrow(/No data returned for ZZZZ/);
  });
});
