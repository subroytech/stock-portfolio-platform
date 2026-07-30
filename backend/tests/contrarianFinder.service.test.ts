jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
// Partial mock (keeps the real AnalysisServiceError class so `instanceof`
// checks elsewhere survive) — only computeContrarianFinderScanBatch itself
// is replaced, same pattern as every other analysisService-consuming test.
jest.mock('../src/services/analysisService', () => ({
  ...jest.requireActual('../src/services/analysisService'),
  computeContrarianFinderScanBatch: jest.fn(),
}));
import { pool } from '../src/db/pool';
import * as analysisService from '../src/services/analysisService';
import {
  buildBatches, filterCandidates, resolveQuality, assembleUniverse, scanStock, scanBatch,
  fetchStockData, assembleScanBatch,
} from '../src/services/contrarianFinder.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockComputeScanBatch = analysisService.computeContrarianFinderScanBatch as jest.Mock;

// Small fixture standing in for the seeded index_constituent table - enough
// symbols per index to exercise dedup across tiers (AAPL in both DJ30/XLK)
// without needing a real DB connection.
const MOCK_CONSTITUENTS: Record<string, string[]> = {
  DJ30: ['AAPL', 'MSFT', 'JPM'],
  NDX100: ['NVDA', 'AMD'],
  SP500: ['AAPL', 'TSLA', 'META'],
  XLK: ['AAPL', 'MSFT'],
  XLV: ['UNH'],
  XLF: ['JPM'],
  XLY: ['AMZN'],
  XLI: ['GE'],
  XLC: ['META'],
  XLP: ['WMT'],
  XLE: ['XOM'],
  XLB: ['LIN'],
  XLU: ['NEE'],
  XLRE: ['AMT'],
};

beforeEach(() => {
  mockQuery.mockImplementation((_text: string, params: string[]) => {
    const indexId = params[0];
    const rows = (MOCK_CONSTITUENTS[indexId] || []).map((symbol) => ({ symbol }));
    return Promise.resolve({ rows });
  });
});

describe('buildBatches', () => {
  test('slices the universe into batches of batchSize, capped at maxBatches', () => {
    const universe = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, tier: 1, source: 'TEST' }));
    const batches = buildBatches(universe, 4, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(4);
    expect(batches[1]).toHaveLength(4);
  });

  test('drops a trailing empty batch when universe is smaller than batchSize * maxBatches', () => {
    const universe = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}`, tier: 1, source: 'TEST' }));
    const batches = buildBatches(universe, 4, 3); // would be 4,4,2
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2]);
  });
});

describe('filterCandidates', () => {
  test('keeps only stocks with changePct <= -threshold, excludes filterFail/noData, sorts worst-first', () => {
    const results = [
      { symbol: 'A', filterFail: false, noData: false, changePct: -10 },
      { symbol: 'B', filterFail: false, noData: false, changePct: -30 },
      { symbol: 'C', filterFail: true },
      { symbol: 'D', filterFail: false, noData: true },
      { symbol: 'E', filterFail: false, noData: false, changePct: -25 },
    ];
    const out = filterCandidates(results, 25);
    expect(out.map((r) => r.symbol)).toEqual(['B', 'E']);
  });
});

describe('resolveQuality', () => {
  test('relaxed preset lowers price/market-cap thresholds', () => {
    expect(resolveQuality('relaxed')).toEqual({ minPrice: 5, minMarketCap: 2.5e9 });
  });
  test('defaults to the standard preset for anything else', () => {
    expect(resolveQuality('standard')).toEqual({ minPrice: 10, minMarketCap: 5e9 });
    expect(resolveQuality(undefined)).toEqual({ minPrice: 10, minMarketCap: 5e9 });
  });
});

describe('assembleUniverse', () => {
  // Queries index_master/index_constituent since 2026-07-10 - pool.query is
  // mocked (see MOCK_CONSTITUENTS above), no real DB connection needed.
  test('builds the universe from index_constituent rows and dedupes across tiers', async () => {
    const universe = await assembleUniverse();
    expect(universe.length).toBeGreaterThan(0);
    const symbols = universe.map((u) => u.symbol);
    expect(new Set(symbols).size).toBe(symbols.length); // no duplicates
    expect(symbols).toContain('AAPL'); // present in DJ30/SP500/XLK fixtures, added once
  });

  test('orders constituent rows deterministically (ORDER BY), unlike an unordered SELECT', async () => {
    await assembleUniverse();
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).toMatch(/ORDER BY/i);
    }
  });
});

describe('scanStock', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function mockQuoteAndHistory(quote: unknown, historical: unknown) {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('historical-price-eod')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(historical) });
      }
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(quote) });
    }) as unknown as typeof fetch;
  }

  test('flags filterFail when price or market cap is below the quality thresholds', async () => {
    mockQuoteAndHistory({ price: 5, marketCap: 1e9 }, []);
    const r = await scanStock('PENNY', 'key', { minPrice: 10, minMarketCap: 5e9 });
    expect(r).toEqual({ symbol: 'PENNY', filterFail: true });
  });

  test('flags noData when fewer than scanDays+1 days of history are available', async () => {
    mockQuoteAndHistory({ price: 100, marketCap: 1e10 }, [{ date: '2026-06-20', close: 100 }]);
    const r = await scanStock('THIN', 'key', { minPrice: 10, minMarketCap: 5e9 }, 7);
    expect(r).toEqual({ symbol: 'THIN', filterFail: false, noData: true });
  });

  test('computes changePct as the % move from scanDays trading days ago to the latest close', async () => {
    const hist = [
      { date: '2026-06-22', close: 80 },
      { date: '2026-06-19', close: 85 },
      { date: '2026-06-18', close: 90 },
      { date: '2026-06-17', close: 95 },
      { date: '2026-06-16', close: 98 },
      { date: '2026-06-15', close: 100 },
    ];
    mockQuoteAndHistory({ price: 80, marketCap: 1e10, name: 'Test Co', sector: 'Technology', volume: 1000, avgVolume: 800 }, hist);
    const r = await scanStock('DROP', 'key', { minPrice: 10, minMarketCap: 5e9 }, 5);
    expect(r.filterFail).toBe(false);
    expect(r.noData).toBe(false);
    // mktClosed false (hist[0].date != today) -> endPrice=price(80), startClose=hist[4].close(98)
    expect(r.changePct).toBeCloseTo((80 - 98) / 98 * 100, 6);
    expect(r.changeSinceDate).toBe('2026-06-16'); // hist[4]'s date - the actual trading day changePct is measured from
    expect(r.strength).toBeNull(); // only 6 closes available, well under the 50-close strength-screen minimum
  });

  test('changeSinceDate reflects the mktClosed branch too (hist[scanDays], not hist[scanDays-1])', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const hist = [
      { date: today, close: 80 },
      { date: '2026-06-19', close: 85 },
      { date: '2026-06-18', close: 90 },
      { date: '2026-06-17', close: 95 },
      { date: '2026-06-16', close: 98 },
      { date: '2026-06-15', close: 100 },
    ];
    mockQuoteAndHistory({ price: 81, marketCap: 1e10, name: 'Test Co' }, hist);
    const r = await scanStock('CLOSED', 'key', { minPrice: 10, minMarketCap: 5e9 }, 5);
    expect(r.mktClosed).toBe(true);
    expect(r.changeSinceDate).toBe('2026-06-15'); // hist[5], since hist[0] is already today's close
  });

  test('strength is null when fewer than 50 closes are available, even with plenty of days for the decline scan', async () => {
    const hist = Array.from({ length: 15 }, (_, i) => ({ date: `2026-06-${10 + i}`, close: 100 + i, low: 99 + i }));
    mockQuoteAndHistory({ price: 114, marketCap: 1e10, name: 'Short Co', sector: 'Technology' }, hist.slice().reverse());
    const r = await scanStock('SHORTHIST', 'key', { minPrice: 10, minMarketCap: 5e9 }, 7);
    expect(r.noData).toBe(false);
    expect(r.strength).toBeNull();
  });

  test('strength screen qualifies a stock with RSI in the ideal zone, above both SMAs, and no recent spike', async () => {
    // Verified empirically (not hand-computed) against the real mwSMA/mwRSI: an
    // oldest->newest series stepping +2/-1 alternately from 100 over 55 bars
    // yields RSI ~65.09, price(127) > sma20(123) > sma50(115.5).
    const oldestFirst = [100];
    for (let i = 1; i < 55; i++) oldestFirst.push(oldestFirst[i - 1] + (i % 2 === 1 ? 2 : -1));
    const newestFirstCloses = [...oldestFirst].reverse();
    const hist = newestFirstCloses.map((close, i) => ({
      date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`,
      close,
      low: close - 1,
    }));
    const price = newestFirstCloses[0]; // 127

    mockQuoteAndHistory(
      { price, marketCap: 1e10, name: 'Strength Co', sector: 'Technology', volume: 1000, avgVolume: 800 },
      hist,
    );
    const r = await scanStock('STRONG', 'key', { minPrice: 10, minMarketCap: 5e9 }, 7);

    expect(r.filterFail).toBe(false);
    expect(r.noData).toBe(false);
    expect(r.changePct).toBeLessThan(10); // hasn't already spiked
    expect(r.strength).not.toBeNull();
    expect(r.strength!.rsi).toBeGreaterThanOrEqual(55);
    expect(r.strength!.rsi).toBeLessThanOrEqual(68);
    expect(r.strength!.sma20).toBeLessThan(price);
    expect(r.strength!.sma50).toBeLessThan(price);
    expect(r.strength!.rr).toBeGreaterThanOrEqual(0);
    expect(r.strength!.kF).toBeGreaterThanOrEqual(0);
    expect(r.strength!.halfKelly).toBeGreaterThanOrEqual(0);
    expect(r.strength!.halfKelly).toBeLessThanOrEqual(0.20);
  });
});

describe('scanBatch — sector backfill', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('backfills sector from m_tickers (FMP /quote has no sector field); leaves it blank for symbols outside the curated set', async () => {
    // Quote deliberately below the quality thresholds - filterFail for both,
    // keeps this test focused on sector backfill rather than the full scan path.
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve({ price: 1, marketCap: 1e6 }),
    }) as unknown as typeof fetch;

    mockQuery.mockImplementation((text: string, params: unknown[]) => {
      expect(text).toMatch(/m_tickers/);
      expect(params[0]).toEqual(['AAPL', 'ZZZZ']);
      return Promise.resolve({ rows: [{ symbol: 'AAPL', sector: 'Technology' }] }); // ZZZZ absent from the curated set
    });

    const stocks = [
      { symbol: 'AAPL', tier: 1, source: 'DJ30' },
      { symbol: 'ZZZZ', tier: 1, source: 'DJ30' },
    ];
    const results = await scanBatch(stocks, 'key', { minPrice: 10, minMarketCap: 5e9 });

    expect(results.find((r) => r.symbol === 'AAPL')?.sector).toBe('Technology');
    expect(results.find((r) => r.symbol === 'ZZZZ')?.sector).toBeFalsy();
  });

  test('makes exactly one batched sector lookup for the whole batch, not one per symbol', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 403, ok: false }) as unknown as typeof fetch;
    mockQuery.mockClear(); // this file's beforeEach only sets behavior, not call-count reset
    mockQuery.mockResolvedValue({ rows: [] });

    const stocks = Array.from({ length: 5 }, (_, i) => ({ symbol: `S${i}`, tier: 1, source: 'TEST' }));
    await scanBatch(stocks, 'key', { minPrice: 10, minMarketCap: 5e9 });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('fetchStockData', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function mockQuoteAndHistory(quote: unknown, historical: unknown) {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('historical-price-eod')) {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(historical) });
      }
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(quote) });
    }) as unknown as typeof fetch;
  }

  test('normalizes a raw FMP quote/history response into RawStockData, with no scoring', async () => {
    mockQuoteAndHistory(
      { price: 100, marketCap: 1e10, name: 'Test Co', sector: 'Technology', volume: 1000, avgVolume: 800 },
      [{ date: '2026-06-20', close: '100.5', low: '99.5' }],
    );
    const data = await fetchStockData('TEST', 'key', 7);
    expect(data.symbol).toBe('TEST');
    expect(data.quote).toEqual({ price: 100, marketCap: 1e10, name: 'Test Co', sector: 'Technology', volume: 1000, avgVolume: 800 });
    expect(data.historicalBars).toEqual([{ date: '2026-06-20', close: 100.5, low: 99.5 }]);
  });

  test('keeps the same bar count even when close/low fail to parse (null, not dropped)', async () => {
    mockQuoteAndHistory({ price: 100, marketCap: 1e10 }, [{ date: '2026-06-20', close: 'not-a-number', low: null }]);
    const data = await fetchStockData('BADDATA', 'key', 7);
    expect(data.historicalBars).toHaveLength(1);
    expect(data.historicalBars[0]).toEqual({ date: '2026-06-20', close: null, low: null });
  });

  test('quote is null when the quote fetch fails entirely', async () => {
    global.fetch = jest.fn((url: string) => (url.includes('historical-price-eod')
      ? Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve([]) })
      : Promise.reject(new Error('network error')))) as unknown as typeof fetch;
    const data = await fetchStockData('NOQUOTE', 'key', 7);
    expect(data.quote).toBeNull();
    expect(data.historicalBars).toEqual([]);
  });
});

describe('assembleScanBatch', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  beforeEach(() => {
    mockComputeScanBatch.mockReset();
    global.fetch = jest.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.resolve({ price: 100, marketCap: 1e10 }),
    }) as unknown as typeof fetch;
  });

  test('sends the whole batch to analysis-service in one call and overlays sector-map fallback + source', async () => {
    mockQuery.mockResolvedValue({ rows: [{ symbol: 'AAPL', sector: 'Technology' }] });
    mockComputeScanBatch.mockResolvedValue([
      { symbol: 'AAPL', filterFail: false, noData: false, changePct: -10, sector: '' },
      { symbol: 'ZZZZ', filterFail: false, noData: false, changePct: -12, sector: '' },
    ]);

    const stocks = [
      { symbol: 'AAPL', tier: 1, source: 'DJ30' },
      { symbol: 'ZZZZ', tier: 1, source: 'DJ30' },
    ];
    const results = await assembleScanBatch(stocks, 'key', { minPrice: 10, minMarketCap: 5e9 });

    expect(mockComputeScanBatch).toHaveBeenCalledTimes(1);
    expect(results.find((r) => r.symbol === 'AAPL')?.sector).toBe('Technology'); // DB overlay
    expect(results.find((r) => r.symbol === 'ZZZZ')?.sector).toBeFalsy(); // outside curated set
    expect(results.every((r) => r.source === 'DJ30')).toBe(true);
  });

  test('a stock whose FMP calls both fail still gets sent to analysis-service, with a null quote/empty history', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    mockComputeScanBatch.mockImplementation(({ stocks: sent }) => Promise.resolve(
      sent.map((s: { symbol: string }) => ({ symbol: s.symbol, filterFail: true })),
    ));

    const stocks = [{ symbol: 'DOWN', tier: 1, source: 'TEST' }];
    await assembleScanBatch(stocks, 'key', { minPrice: 10, minMarketCap: 5e9 });

    expect(mockComputeScanBatch).toHaveBeenCalledTimes(1);
    const sentStocks = mockComputeScanBatch.mock.calls[0][0].stocks;
    expect(sentStocks).toEqual([{ symbol: 'DOWN', quote: null, historicalBars: [] }]);
  });

  test('skips the analysis-service call entirely for an empty batch', async () => {
    const results = await assembleScanBatch([], 'key', { minPrice: 10, minMarketCap: 5e9 });
    expect(mockComputeScanBatch).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  test('a symbol missing from the analysis-service response falls back to an error result', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockComputeScanBatch.mockResolvedValue([]); // Python returned nothing for the one stock sent

    const stocks = [{ symbol: 'DROPPED', tier: 1, source: 'TEST' }];
    const results = await assembleScanBatch(stocks, 'key', { minPrice: 10, minMarketCap: 5e9 });

    expect(results).toEqual([{ symbol: 'DROPPED', filterFail: true, error: true }]);
  });
});
