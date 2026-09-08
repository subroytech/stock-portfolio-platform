// Daily FMP cache (fmpDailyCache.service.ts, migration 042) sits between this module and the
// real network fetch now. Mocked to a pure pass-through (always calls fetchFn, always reports a
// miss) by default - every existing test below still exercises the real fmpGet -> global.fetch
// chain unchanged, and since nothing is ever actually served from cache in that default mode,
// "every call attempted" still equals "every call counted", so the pre-existing apiCallCounts
// assertions are untouched. isMarketOpenNow defaults to false (market closed) so quote behaves
// like every other cacheable call unless a specific test says otherwise.
jest.mock('../src/services/fmpDailyCache.service', () => ({
  ...jest.requireActual('../src/services/fmpDailyCache.service'),
  getOrFetch: jest.fn(),
  isMarketOpenNow: jest.fn(),
}));

import { fetchLongTermAnalysisData } from '../src/services/longTermAnalysisData.service';
import * as fmpDailyCache from '../src/services/fmpDailyCache.service';

const mockGetOrFetch = fmpDailyCache.getOrFetch as jest.Mock;
const mockIsMarketOpenNow = fmpDailyCache.isMarketOpenNow as jest.Mock;

beforeEach(() => {
  mockIsMarketOpenNow.mockReset().mockReturnValue(false);
  mockGetOrFetch.mockReset().mockImplementation(
    async (_symbol: string, _apiName: string, _description: string, fetchFn: () => Promise<unknown>) => ({
      data: await fetchFn(),
      wasCached: false,
    }),
  );
});

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
    });

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', 'fake-finnhub-key');

    expect(data.symbol).toBe('AAPL');
    expect(data.companyName).toBe('Apple Inc.');
    expect(data.price).toBe(200); // quote.price preferred over profile.price
    expect(data.incomeStatements).toHaveLength(2);
    expect(data.peers).toEqual([{ symbol: 'MSFT', price: 400, trailingPe: 20, evToEbitda: 20, marketCap: 3e12 }]);
    // financial-estimates removed entirely (2026-09-07) - it never once returned usable data on
    // this account's tier, so forwardEpsEstimate now stays null unconditionally, no call made.
    expect(data.forwardEpsEstimate).toBeNull();
    expect(data.evToEbitda).toBe(22);
    // Grades are passed through raw and undeduplicated — bucketing is Python's job.
    expect(data.grades).toHaveLength(2);
    // 6 critical + 1 stock-peers list + 2 for the 1 peer (quote + key-metrics) +
    // 1 key-metrics-for-symbol = 10 FMP calls, 1 Finnhub (key given).
    expect(data.apiCallCounts).toEqual({ fmp: 10, finnhub: 1 });
  });

  test('apiCallCounts scales with the number of peers returned', async () => {
    mockFetchByUrl({
      ...CRITICAL_HAPPY_ROUTES,
      '/stock-peers?': [{ symbol: 'MSFT' }, { symbol: 'GOOGL' }],
      '/quote?symbol=MSFT': [{ price: 400 }],
      '/quote?symbol=GOOGL': [{ price: 150 }],
      '/key-metrics?symbol=MSFT': [{ earningsYield: 0.05 }],
      '/key-metrics?symbol=GOOGL': [{ earningsYield: 0.04 }],
      '/key-metrics?symbol=AAPL': [{ earningsYield: 0.025 }],
    });

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', undefined);

    expect(data.peers).toHaveLength(2);
    // 6 critical + 1 stock-peers list + 4 for 2 peers (2 calls each)
    // + 1 key-metrics-for-symbol = 12 FMP calls, 0 Finnhub (no key given).
    expect(data.apiCallCounts).toEqual({ fmp: 12, finnhub: 0 });
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
    expect(data.forwardEpsEstimate).toBeNull(); // always null now - financial-estimates removed entirely
    expect(data.evToEbitda).toBeNull();
    expect(data.news).toEqual([]);
    // Zero peers still counts the 1 attempted (and failed) stock-peers list call - the
    // EV-EBITDA call is also attempted (and failed) once regardless.
    expect(data.apiCallCounts).toEqual({ fmp: 6 + 1 + 0 + 1, finnhub: 1 });
  });

  test('no Finnhub key provided means news stays empty without any Finnhub call', async () => {
    mockFetchByUrl(CRITICAL_HAPPY_ROUTES);
    const fetchSpy = global.fetch as jest.Mock;

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', undefined);

    expect(data.news).toEqual([]);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('finnhub'))).toBe(false);
    // stock-peers resolves to [] (not rejected) here, so 0 peers were extracted - still 1
    // attempted list call, same shape as the failure case above.
    expect(data.apiCallCounts).toEqual({ fmp: 6 + 1 + 0 + 1, finnhub: 0 });
  });

  test('a fully cached day (every getOrFetch call reports a hit) logs zero real FMP calls', async () => {
    // Real cache hits never invoke fetchFn at all - unlike the default beforeEach mock, this
    // returns canned data directly per apiName, proving the dynamic count actually drops to 0
    // rather than just relying on fetchFn never resolving.
    const CACHED_DATA: Record<string, unknown> = {
      profile: [{ companyName: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ', marketCap: 3e12, beta: 1.2, range: '150-220', lastDividend: 1, price: 199 }],
      quote: [{ price: 200 }],
      'income-statement': [{ fiscalYear: '2026', revenue: 1100, grossProfit: 550, operatingIncome: 220, netIncome: 200, eps: 6.1 }],
      earnings: [{ date: '2026-06-30', epsActual: 1.6, epsEstimated: 1.5 }],
      'price-target-consensus': [{ targetConsensus: 230, targetHigh: 260, targetLow: 190 }],
      grades: [],
      'stock-peers': [],
      'key-metrics': [{ evToEBITDA: 22, earningsYield: 0.025 }],
    };
    mockGetOrFetch.mockImplementation(async (_symbol: string, apiName: string) => ({
      data: CACHED_DATA[apiName] ?? [],
      wasCached: true,
    }));

    const data = await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', undefined);

    expect(data.companyName).toBe('Apple Inc.');
    expect(data.apiCallCounts).toEqual({ fmp: 0, finnhub: 0 });
  });

  test('only the subject\'s own quote is requested with forceFresh while the market is open - peer quotes and every other call are not', async () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    mockFetchByUrl({
      ...CRITICAL_HAPPY_ROUTES,
      '/stock-peers?': [{ symbol: 'MSFT' }],
      '/quote?symbol=MSFT': [{ price: 400 }],
      '/key-metrics?symbol=MSFT': [{ earningsYield: 0.05 }],
      '/key-metrics?symbol=AAPL': [{ evToEBITDA: 22, earningsYield: 0.025 }],
    });

    await fetchLongTermAnalysisData('AAPL', 'fake-fmp-key', undefined);

    const subjectQuoteCall = mockGetOrFetch.mock.calls.find((c) => c[0] === 'AAPL' && c[1] === 'quote');
    expect(subjectQuoteCall?.[4]).toEqual({ forceFresh: true });
    const profileCall = mockGetOrFetch.mock.calls.find((c) => c[1] === 'profile');
    expect(profileCall?.[4]).toBeUndefined();
    // Peer quotes are day-cached like everything else, not forced fresh - a user isn't staring
    // at a peer's price directly, only the relative valuation ratios it feeds.
    const peerQuoteCall = mockGetOrFetch.mock.calls.find((c) => c[0] === 'MSFT' && c[1] === 'quote');
    expect(peerQuoteCall?.[4]).toBeUndefined();
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
