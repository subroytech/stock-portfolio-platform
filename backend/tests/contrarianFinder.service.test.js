const {
  buildBatches, filterCandidates, resolveQuality, assembleUniverse, scanStock, runScan,
} = require('../src/services/contrarianFinder.service');

describe('buildBatches', () => {
  test('slices the universe into batches of batchSize, capped at maxBatches', () => {
    const universe = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}` }));
    const batches = buildBatches(universe, 4, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(4);
    expect(batches[1]).toHaveLength(4);
  });

  test('drops a trailing empty batch when universe is smaller than batchSize * maxBatches', () => {
    const universe = Array.from({ length: 10 }, (_, i) => ({ symbol: `S${i}` }));
    const batches = buildBatches(universe, 4, 3); // would be 4,4,2
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2]);
  });
});

describe('filterCandidates', () => {
  test('keeps only stocks with change5d <= -threshold, excludes filterFail/noData, sorts worst-first', () => {
    const results = [
      { symbol: 'A', filterFail: false, noData: false, change5d: -10 },
      { symbol: 'B', filterFail: false, noData: false, change5d: -30 },
      { symbol: 'C', filterFail: true },
      { symbol: 'D', filterFail: false, noData: true },
      { symbol: 'E', filterFail: false, noData: false, change5d: -25 },
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
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('falls back to CF_STATIC lists and dedupes across tiers when FMP endpoints fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const universe = await assembleUniverse('fake-key');
    expect(universe.length).toBeGreaterThan(0);
    const symbols = universe.map((u) => u.symbol);
    expect(new Set(symbols).size).toBe(symbols.length); // no duplicates
    expect(symbols).toContain('AAPL'); // present in dj30/ndx100/sp500 static lists, added once
  });
});

describe('scanStock', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function mockQuoteAndHistory(quote, historical) {
    global.fetch = jest.fn((url) => {
      if (url.includes('historical-price-eod')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(historical) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(quote) });
    });
  }

  test('flags filterFail when price or market cap is below the quality thresholds', async () => {
    mockQuoteAndHistory({ price: 5, marketCap: 1e9 }, []);
    const r = await scanStock('PENNY', 'key', { minPrice: 10, minMarketCap: 5e9 });
    expect(r).toEqual({ symbol: 'PENNY', filterFail: true });
  });

  test('flags noData when fewer than 6 days of history are available', async () => {
    mockQuoteAndHistory({ price: 100, marketCap: 1e10 }, [{ date: '2026-06-20', close: 100 }]);
    const r = await scanStock('THIN', 'key', { minPrice: 10, minMarketCap: 5e9 });
    expect(r).toEqual({ symbol: 'THIN', filterFail: false, noData: true });
  });

  test('computes change5d as the % move from 5 trading days ago to the latest close', async () => {
    const hist = [
      { date: '2026-06-22', close: 80 },
      { date: '2026-06-19', close: 85 },
      { date: '2026-06-18', close: 90 },
      { date: '2026-06-17', close: 95 },
      { date: '2026-06-16', close: 98 },
      { date: '2026-06-15', close: 100 },
    ];
    mockQuoteAndHistory({ price: 80, marketCap: 1e10, name: 'Test Co', sector: 'Technology', volume: 1000, avgVolume: 800 }, hist);
    const r = await scanStock('DROP', 'key', { minPrice: 10, minMarketCap: 5e9 });
    expect(r.filterFail).toBe(false);
    expect(r.noData).toBe(false);
    // mktClosed false (hist[0].date != today) -> endPrice=price(80), startClose=hist[4].close(98)
    expect(r.change5d).toBeCloseTo((80 - 98) / 98 * 100, 6);
  });
});

describe('runScan (integration, no real network/timers)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('assembles a universe, scans it in batches, and returns results with waitSeconds=0', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }); // forces static fallback + filterFail for all (no quote data)
    const out = await runScan({ key: 'fake-key', batchSize: 5, maxBatches: 1, waitSeconds: 0 });
    expect(out.universeSize).toBeGreaterThan(0);
    expect(out.scanned).toBe(5);
    expect(out.results).toHaveLength(5);
    expect(out.results.every((r) => r.filterFail)).toBe(true); // no quote ever succeeded
  });
});
