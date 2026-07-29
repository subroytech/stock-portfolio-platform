import { fetchContrarianComebackData } from '../src/services/contrarianComebackData.service';

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
  '/income-statement?': [{ fiscalYear: '2026', revenue: 1100 }, { fiscalYear: '2025', revenue: 1000 }],
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
    expect(data.peRatio).toBe(28); // profile.pe preferred over quote.pe
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
  });

  test('a critical call rejecting (e.g. invalid FMP key) propagates the error', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/profile?')) return Promise.resolve({ status: 401, ok: false });
      return Promise.resolve(jsonResponse([]));
    }) as unknown as typeof fetch;

    await expect(fetchContrarianComebackData('AAPL', 'bad-key')).rejects.toThrow();
  });
});
