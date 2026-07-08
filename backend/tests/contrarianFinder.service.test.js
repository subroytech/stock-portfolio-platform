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
  // Static-only since 2026-07-08 - no fetch involved at all, so no mocking needed.
  test('builds the universe from CF_STATIC lists and dedupes across tiers', () => {
    const universe = assembleUniverse();
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
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(historical) });
      }
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(quote) });
    });
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
    expect(r.strength).toBeNull(); // only 6 closes available, well under the 50-close strength-screen minimum
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
    expect(r.strength.rsi).toBeGreaterThanOrEqual(55);
    expect(r.strength.rsi).toBeLessThanOrEqual(68);
    expect(r.strength.sma20).toBeLessThan(price);
    expect(r.strength.sma50).toBeLessThan(price);
    expect(r.strength.rr).toBeGreaterThanOrEqual(0);
    expect(r.strength.kF).toBeGreaterThanOrEqual(0);
    expect(r.strength.halfKelly).toBeGreaterThanOrEqual(0);
    expect(r.strength.halfKelly).toBeLessThanOrEqual(0.20);
  });
});

describe('runScan (integration, no real network/timers)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('assembles a universe, scans it in batches, and returns results with waitSeconds=0', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 403, ok: false }); // forces filterFail for all (no quote data)
    const out = await runScan({ key: 'fake-key', batchSize: 5, maxBatches: 1, waitSeconds: 0 });
    expect(out.universeSize).toBeGreaterThan(0);
    expect(out.scanned).toBe(5);
    expect(out.results).toHaveLength(5);
    expect(out.results.every((r) => r.filterFail)).toBe(true); // no quote ever succeeded
  });
});
