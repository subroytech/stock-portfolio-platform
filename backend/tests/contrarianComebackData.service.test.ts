// Daily FMP cache (fmpDailyCache.service.ts, migration 042, Phase 2) sits between this module
// and the real network fetch now. Mocked to a pure pass-through (always calls fetchFn, always
// reports a miss) by default - every existing test below still exercises the real fmpGet ->
// global.fetch chain unchanged, and since nothing is ever actually served from cache in that
// default mode, "every call attempted" still equals "every call counted", so the pre-existing
// apiCallCounts assertions are untouched. isMarketOpenNow defaults to false (market closed) so
// quote behaves like every other cacheable call unless a specific test says otherwise.
//
// jest.requireActual below still loads the real fmpDailyCache.service.ts, which imports the
// real ../db/pool - that throws at module-load time when DATABASE_URL isn't set (CI's backend
// job never sets it, by design - unit tests shouldn't need a real DB). Mocking pool directly
// here is what makes that load safe.
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/fmpDailyCache.service', () => ({
  ...jest.requireActual('../src/services/fmpDailyCache.service'),
  getOrFetch: jest.fn(),
  isMarketOpenNow: jest.fn(),
}));

import { fetchContrarianComebackData } from '../src/services/contrarianComebackData.service';
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

function mockFetchByUrl(routes: Record<string, unknown>) {
  global.fetch = jest.fn((url: string) => {
    for (const [match, body] of Object.entries(routes)) {
      if (url.includes(match)) return Promise.resolve(jsonResponse(body));
    }
    return Promise.resolve(jsonResponse([]));
  }) as unknown as typeof fetch;
}

const CRITICAL_HAPPY_ROUTES = {
  '/profile?': [{ companyName: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ', mktCap: 3e12, pe: 28 }],
  '/quote?symbol=AAPL': [{ price: 200, yearHigh: 260, marketCap: 3e12, pe: 27 }],
  // eps only appears on the most recent period - profile.pe/quote.pe are both
  // absent on FMP's /stable tier, so peRatio is derived from price/eps here.
  '/income-statement?': [{ fiscalYear: '2026', revenue: 1100, eps: 5 }, { fiscalYear: '2025', revenue: 1000 }],
  '/price-target-consensus?': [{ targetConsensus: 230, targetHigh: 260, targetLow: 190 }],
  '/grades?': [{ gradingCompany: 'Firm A', newGrade: 'Buy', action: 'upgrade', date: '2026-01-01' }],
  '/insider-trading/search?': [{ transactionDate: '2026-07-01', transactionType: 'P-Purchase', acquisitionOrDisposition: 'A', securitiesTransacted: 100, price: 50, reportingName: 'Jane Doe' }],
  'historical-price-eod/full?symbol=AAPL': [{ date: '2026-07-20', high: 205, low: 195, close: 200, volume: 1000 }],
  '/balance-sheet-statement?': [{ totalDebt: 1000, totalStockholdersEquity: 2000, totalCurrentAssets: 500, totalCurrentLiabilities: 300, cashAndCashEquivalents: 400 }],
  '/cash-flow-statement?': [{ operatingCashFlow: 300, capitalExpenditure: -50 }],
};

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe('fetchContrarianComebackData', () => {
  test('happy path assembles the full payload, including the mapped sector ETF', async () => {
    mockFetchByUrl({
      ...CRITICAL_HAPPY_ROUTES,
      'historical-price-eod/full?symbol=XLK': [{ date: '2026-07-20', high: 105, low: 95, close: 100, volume: 500 }],
    });

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key', 'fake-finnhub-key');

    expect(data.symbol).toBe('AAPL');
    expect(data.companyName).toBe('Apple Inc.');
    expect(data.sector).toBe('Technology');
    expect(data.price).toBe(200); // quote.price preferred
    expect(data.marketCap).toBe(3e12); // profile.mktCap preferred
    expect(data.yearHigh).toBe(260);
    expect(data.peRatio).toBe(40); // derived from price/eps (200/5) - profile.pe/quote.pe are both ignored
    expect(data.incomeStatements).toEqual([{ revenue: 1100, grossProfit: null }, { revenue: 1000, grossProfit: null }]);
    expect(data.dailyBars).toHaveLength(1);
    expect(data.etfSymbol).toBe('XLK');
    expect(data.etfDailyBars).toHaveLength(1);
    expect(data.priceTarget).toEqual({ targetConsensus: 230, targetHigh: 260, targetLow: 190 });
    expect(data.grades).toEqual([{ gradingCompany: 'Firm A', newGrade: 'Buy', action: 'upgrade', date: '2026-01-01' }]);
    expect(data.insiderTrades[0].acquisitionOrDisposition).toBe('A');
    expect(data.totalDebt).toBe(1000);
    expect(data.totalStockholdersEquity).toBe(2000);
    expect(data.cashAndCashEquivalents).toBe(400);
    expect(data.operatingCashFlow).toBe(300);
    expect(data.capitalExpenditure).toBe(-50);
    // 7 critical + 1 conditional ETF historical (mapped sector) + 2 fundamentals = 10 FMP
    // calls, 1 Finnhub (key given).
    expect(data.apiCallCounts).toEqual({ fmp: 10, finnhub: 1 });
  });

  test('balance-sheet/cash-flow fetch failure degrades gracefully - Fundamental Health just sees null fields', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('balance-sheet-statement') || url.includes('cash-flow-statement')) return Promise.reject(new Error('simulated failure'));
      for (const [match, body] of Object.entries(CRITICAL_HAPPY_ROUTES)) {
        if (url.includes(match)) return Promise.resolve(jsonResponse(body));
      }
      return Promise.resolve(jsonResponse([]));
    }) as unknown as typeof fetch;

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key');
    expect(data.totalDebt).toBeNull();
    expect(data.operatingCashFlow).toBeNull();
  });

  test('sector with no mapped ETF skips the second historical-price-eod call entirely', async () => {
    mockFetchByUrl({ ...CRITICAL_HAPPY_ROUTES, '/profile?': [{ companyName: 'Apple Inc.', sector: 'Unmapped Sector', mktCap: 3e12 }] });
    const fetchSpy = global.fetch as jest.Mock;

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key');

    expect(data.etfSymbol).toBeNull();
    expect(data.etfDailyBars).toEqual([]);
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes('historical-price-eod'))).toHaveLength(1); // stock only
    // No ETF mapping means the conditional call is never attempted: 7 critical + 0 + 2
    // fundamentals = 9 FMP calls.
    expect(data.apiCallCounts).toEqual({ fmp: 9, finnhub: 0 });
  });

  test('ETF fetch failure degrades gracefully - Check 3 just sees no ETF data', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('historical-price-eod/full?symbol=XLK')) return Promise.reject(new Error('simulated failure'));
      for (const [match, body] of Object.entries(CRITICAL_HAPPY_ROUTES)) {
        if (url.includes(match)) return Promise.resolve(jsonResponse(body));
      }
      return Promise.resolve(jsonResponse([]));
    }) as unknown as typeof fetch;

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key');
    expect(data.etfSymbol).toBe('XLK');
    expect(data.etfDailyBars).toEqual([]);
  });

  test('no Finnhub key provided means news stays empty without any Finnhub call', async () => {
    mockFetchByUrl(CRITICAL_HAPPY_ROUTES);
    const fetchSpy = global.fetch as jest.Mock;

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key', undefined);

    expect(data.news).toEqual([]);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('finnhub'))).toBe(false);
    // Technology (the default profile's sector here) maps to an ETF, so the conditional
    // call is still attempted even with no Finnhub key: 7 + 1 + 2 = 10 FMP, 0 Finnhub.
    expect(data.apiCallCounts).toEqual({ fmp: 10, finnhub: 0 });
  });

  test('a critical call rejecting (e.g. invalid FMP key) propagates the error', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/profile?')) return Promise.resolve({ status: 401, ok: false });
      return Promise.resolve(jsonResponse([]));
    }) as unknown as typeof fetch;

    await expect(fetchContrarianComebackData('AAPL', 'bad-key')).rejects.toThrow();
  });

  test('a fully cached day (every getOrFetch call reports a hit) logs zero real FMP calls', async () => {
    // Real cache hits never invoke fetchFn at all - returns canned data directly per apiName,
    // proving the dynamic count actually drops to 0 rather than just relying on fetchFn never
    // resolving. No ETF mapping here (Unmapped Sector) so the conditional call never even fires.
    const CACHED_DATA: Record<string, unknown> = {
      profile: [{ companyName: 'Apple Inc.', sector: 'Unmapped Sector', exchange: 'NASDAQ', mktCap: 3e12 }],
      quote: [{ price: 200, yearHigh: 260, marketCap: 3e12 }],
      'income-statement': [{ fiscalYear: '2026', revenue: 1100, eps: 5 }],
      'price-target-consensus': [{ targetConsensus: 230, targetHigh: 260, targetLow: 190 }],
      grades: [],
      'insider-trading': [],
      'historical-price-eod': [{ date: '2026-07-20', high: 205, low: 195, close: 200, volume: 1000 }],
      'balance-sheet-statement': [{ totalDebt: 1000 }],
      'cash-flow-statement': [{ operatingCashFlow: 300 }],
    };
    mockGetOrFetch.mockImplementation(async (_symbol: string, apiName: string) => ({
      data: CACHED_DATA[apiName] ?? [],
      wasCached: true,
    }));

    const data = await fetchContrarianComebackData('AAPL', 'fake-fmp-key', undefined);

    expect(data.companyName).toBe('Apple Inc.');
    expect(data.apiCallCounts).toEqual({ fmp: 0, finnhub: 0 });
  });

  test('only the subject\'s own quote is requested with forceFresh while the market is open - every other call is not', async () => {
    mockIsMarketOpenNow.mockReturnValue(true);
    mockFetchByUrl({ ...CRITICAL_HAPPY_ROUTES, '/profile?': [{ companyName: 'Apple Inc.', sector: 'Unmapped Sector', mktCap: 3e12 }] });

    await fetchContrarianComebackData('AAPL', 'fake-fmp-key', undefined);

    const quoteCall = mockGetOrFetch.mock.calls.find((c) => c[0] === 'AAPL' && c[1] === 'quote');
    expect(quoteCall?.[4]).toEqual({ forceFresh: true });
    const profileCall = mockGetOrFetch.mock.calls.find((c) => c[1] === 'profile');
    expect(profileCall?.[4]).toBeUndefined();
    const incomeCall = mockGetOrFetch.mock.calls.find((c) => c[1] === 'income-statement');
    expect(incomeCall?.[4]).toBeUndefined();
  });
});
