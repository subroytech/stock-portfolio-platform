import { mwSMA, mwRSI, mwMACD, mwBB, calcKellySizing, assembleMomentumAnalysis } from '../src/services/momentum.service';

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
  // Gating matrix mirrors the source app's tests/momentum.test.js — score <6
  // means no position regardless of R:R; the 10% floor only applies at
  // score >=7; the 20% cap always applies at any qualifying score.
  test('returns zero position sizing for non-positive R:R', () => {
    const s = calcKellySizing(0, 50000, 100, 8);
    expect(s.kF).toBe(0);
    expect(s.hk).toBe(0);
    expect(s.pos).toBe(0);
    expect(s.sh).toBe(0);
  });

  test('score below 6 => no position, regardless of R:R', () => {
    const s = calcKellySizing(3, 50000, 100, 5);
    expect(s.noEntry).toBe(true);
    expect(s.hk).toBe(0);
    expect(s.pos).toBe(0);
    expect(s.sh).toBe(0);
  });

  test('score 6 => sized, but NO 10% floor applied', () => {
    // rr=1.0 => kF=0.10 => kF/2=0.05, below the 10% floor
    const s = calcKellySizing(1.0, 100000, 100, 6);
    expect(s.noEntry).toBe(false);
    expect(s.kF).toBeCloseTo(0.10, 6);
    expect(s.hk).toBeCloseTo(0.05, 6);
  });

  test('score 7+ => 10% floor kicks in for the same R:R that scored 5% at score 6', () => {
    const s = calcKellySizing(1.0, 100000, 100, 7);
    expect(s.noEntry).toBe(false);
    expect(s.hk).toBeCloseTo(0.10, 6);
  });

  test('caps Half-Kelly between 10% and 20% of capital for a strong R:R', () => {
    const s = calcKellySizing(5, 50000, 100, 8); // high R:R -> kF large -> hk capped at 0.20
    expect(s.hk).toBeCloseTo(0.20, 6);
    expect(s.pos).toBeCloseTo(10000, 6);
    expect(s.sh).toBe(100); // floor(10000 / 100)
  });

  test('20% cap applies at score 6 too, same as score 7+', () => {
    const s6 = calcKellySizing(5, 50000, 100, 6);
    const s8 = calcKellySizing(5, 50000, 100, 8);
    expect(s6.hk).toBeCloseTo(0.20, 6);
    expect(s8.hk).toBeCloseTo(0.20, 6);
  });

  test('computes shares as floor(position $ / entry price)', () => {
    const s = calcKellySizing(3, 10000, 33, 8);
    expect(s.sh).toBe(Math.floor(s.pos / 33));
  });

  test('entryMid of 0 yields 0 shares without throwing (division guard)', () => {
    const s = calcKellySizing(1.0, 100000, 0, 7);
    expect(s.sh).toBe(0);
  });
});

describe('assembleMomentumAnalysis', () => {
  // newest-first descending integers -> oldest->newest is strictly increasing,
  // same construction as the mwRSI "strictly increasing" test above (RSI=100).
  function makeSeries(len: number) {
    return Array.from({ length: len }, (_, i) => len - i);
  }

  test('score.total equals the sum of its component scores', () => {
    const closes = makeSeries(60);
    const lows = closes.map((c) => c - 1);
    const volumes = [300, ...Array(19).fill(100), ...Array(40).fill(100)];
    const a = assembleMomentumAnalysis(closes, lows, volumes, closes[0]);
    const { rsi, macd, volume, trend, riskReward, total } = a.score;
    expect(total).toBe(rsi + macd + volume + trend + riskReward);
  });

  test('signal is derived from score.total via the documented thresholds', () => {
    const closes = makeSeries(60);
    const lows = closes.map((c) => c - 1);
    const volumes = Array(60).fill(100);
    const a = assembleMomentumAnalysis(closes, lows, volumes, closes[0]);
    const expected = a.score.total >= 8 ? 'STRONG BUY'
      : a.score.total >= 6 ? 'BUY'
      : a.score.total >= 4 ? 'WATCH' : 'AVOID';
    expect(a.signal).toBe(expected);
  });

  test('dayChg is the difference between the two most recent closes', () => {
    const closes = makeSeries(40);
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), Array(40).fill(100), closes[0]);
    expect(a.dayChg).toBeCloseTo(closes[0] - closes[1], 6);
  });

  test('high relative volume with a positive day change scores the volume component at 2', () => {
    const closes = makeSeries(40); // dayChg = closes[0]-closes[1] = 1 > 0
    const volumes = [1000, ...Array(19).fill(100), ...Array(20).fill(100)];
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), volumes, closes[0]);
    expect(a.volRatio).toBeGreaterThan(1.5);
    expect(a.score.volume).toBe(2);
  });

  test('trend scores 2 when price is above both sma20 and sma50', () => {
    const closes = makeSeries(60);
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), Array(60).fill(100), closes[0]);
    expect(closes[0]).toBeGreaterThan(a.sma20);
    expect(closes[0]).toBeGreaterThan(a.sma50);
    expect(a.score.trend).toBe(2);
  });

  test('extras flags RSI overbought for a strictly-increasing (RSI=100) series', () => {
    const closes = makeSeries(40);
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), Array(40).fill(100), closes[0]);
    expect(a.rsi).toBe(100);
    expect(a.extras).toContain('RSI overbought — consider waiting for a pullback before entry');
  });

  test('flags always include at least one Bollinger-position message', () => {
    const closes = makeSeries(40);
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), Array(40).fill(100), closes[0]);
    expect(a.flags.length).toBeGreaterThanOrEqual(1);
    expect(a.flags.length).toBeLessThanOrEqual(2);
  });

  test('entryMid sits between stopLoss and target for a healthy uptrend setup', () => {
    const closes = makeSeries(60);
    const a = assembleMomentumAnalysis(closes, closes.map((c) => c - 1), Array(60).fill(100), closes[0]);
    expect(a.stopLoss).toBeLessThan(a.entryMid);
    expect(a.entryMid).toBeLessThan(a.target);
  });
});
