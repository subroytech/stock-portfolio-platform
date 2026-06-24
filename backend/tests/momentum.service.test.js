const { mwSMA, mwRSI, mwMACD, mwBB, calcKellySizing } = require('../src/services/momentum.service');

describe('mwSMA', () => {
  test('averages the first n elements (newest-first array)', () => {
    const closes = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(mwSMA(closes, 5)).toBeCloseTo(8, 6); // (10+9+8+7+6)/5
  });
});

describe('mwRSI', () => {
  test('is 100 for a strictly increasing price series (no losses)', () => {
    const increasing = Array.from({ length: 20 }, (_, i) => 20 - i); // newest-first: 20,19,...,1 -> oldest->newest is increasing
    expect(mwRSI(increasing, 14)).toBe(100);
  });

  test('is 0 for a strictly decreasing price series (no gains)', () => {
    const decreasing = Array.from({ length: 20 }, (_, i) => i + 1); // newest-first: 1,2,...,20 -> oldest->newest is decreasing
    expect(mwRSI(decreasing, 14)).toBe(0);
  });

  test('is 50 when average gains equal average losses over exactly the seed window', () => {
    // 15 closes -> 14 diffs = exactly Wilder's seed window (n=14), alternating
    // +1/-1 so avg gain == avg loss with no further smoothing to skew it.
    const len = 15;
    const oldestFirst = [100];
    for (let i = 1; i < len; i++) oldestFirst.push(oldestFirst[i - 1] + (i % 2 === 0 ? 1 : -1));
    const newestFirst = [...oldestFirst].reverse();
    expect(mwRSI(newestFirst, 14)).toBeCloseTo(50, 5);
  });
});

describe('mwMACD', () => {
  test('returns macd/signal/hist/prev fields with hist = macd - signal', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i); // newest-first synthetic uptrend
    const r = mwMACD(closes);
    expect(r.hist).toBeCloseTo(r.macd - r.signal, 6);
    expect(typeof r.prevMacd).toBe('number');
    expect(typeof r.prevSig).toBe('number');
  });
});

describe('mwBB', () => {
  test('collapses to a flat band (upper=mid=lower, bw=0) for constant prices', () => {
    const flat = Array(20).fill(50);
    const bb = mwBB(flat, 20);
    expect(bb.mid).toBe(50);
    expect(bb.upper).toBe(50);
    expect(bb.lower).toBe(50);
    expect(bb.bw).toBe(0);
  });

  test('upper > mid > lower for a varying series', () => {
    const closes = [22, 21, 19, 23, 18, 25, 17, 24, 20, 26, 16, 27, 15, 28, 14, 29, 13, 30, 12, 31];
    const bb = mwBB(closes, 20);
    expect(bb.upper).toBeGreaterThan(bb.mid);
    expect(bb.mid).toBeGreaterThan(bb.lower);
  });
});

describe('calcKellySizing', () => {
  test('returns zero position sizing for non-positive R:R', () => {
    const s = calcKellySizing(0, 50000, 100);
    expect(s.kF).toBe(0);
    expect(s.hk).toBe(0);
    expect(s.pos).toBe(0);
    expect(s.sh).toBe(0);
  });

  test('caps Half-Kelly between 10% and 20% of capital for a strong R:R', () => {
    const s = calcKellySizing(5, 50000, 100); // high R:R -> kF large -> hk capped at 0.20
    expect(s.hk).toBeCloseTo(0.20, 6);
    expect(s.pos).toBeCloseTo(10000, 6);
    expect(s.sh).toBe(100); // floor(10000 / 100)
  });

  test('computes shares as floor(position $ / entry price)', () => {
    const s = calcKellySizing(3, 10000, 33);
    expect(s.sh).toBe(Math.floor(s.pos / 33));
  });
});
