import {
  computeVWAP, computePivotPoints, computeFibonacciRetracement,
  computeSmaSeries, computeBbSeries, computeRsiSeries, computeMacdSeries,
  type CandlestickBar,
} from '../src/services/candlestickIndicators.service';
import { mwSMA, mwBB, mwRSI, mwMACD } from '../src/services/momentum.service';

describe('computeVWAP', () => {
  test('cumulative volume-weighted average, oldest bar forward, returned newest-first', () => {
    const barOld: CandlestickBar = { date: 'd1', open: 9, high: 10, low: 8, close: 9, volume: 100 };
    const barNew: CandlestickBar = { date: 'd2', open: 11, high: 12, low: 10, close: 11, volume: 100 };
    // typical(old) = (10+8+9)/3 = 9 -> vwap after bar1 = 9
    // typical(new) = (12+10+11)/3 = 11 -> cumulative tpv = 900+1100=2000, vol=200 -> vwap = 10
    const result = computeVWAP([barNew, barOld]); // newest-first input
    expect(result).toEqual([10, 9]);
  });

  test('a zero-volume bar falls back to its own typical price instead of dividing by zero', () => {
    const bar: CandlestickBar = { date: 'd1', open: 10, high: 12, low: 8, close: 10, volume: 0 };
    expect(computeVWAP([bar])).toEqual([10]); // typical = (12+8+10)/3 = 10
  });
});

describe('computePivotPoints', () => {
  test('classic formula derived from the prior (bars[1]) bar', () => {
    const current: CandlestickBar = { date: 'd2', open: 100, high: 105, low: 98, close: 102, volume: 1000 };
    const prior: CandlestickBar = { date: 'd1', open: 95, high: 110, low: 90, close: 100, volume: 1000 };
    const result = computePivotPoints([current, prior]);
    // pp = (110+90+100)/3 = 100, range = 20
    expect(result).toEqual({
      pp: 100,
      r1: 110, s1: 90, // 2*100-90=110, 2*100-110=90
      r2: 120, s2: 80, // 100+20, 100-20
      r3: 130, s3: 70, // 110+2*(100-90)=130, 90-2*(110-100)=70
    });
  });

  test('null when fewer than 2 bars are available', () => {
    expect(computePivotPoints([{ date: 'd1', open: 1, high: 1, low: 1, close: 1, volume: 1 }])).toBeNull();
    expect(computePivotPoints([])).toBeNull();
  });
});

describe('computeFibonacciRetracement', () => {
  test('uptrend swing (low before high) retraces DOWN from the high', () => {
    const barOldest: CandlestickBar = { date: 'd1', open: 55, high: 60, low: 50, close: 58, volume: 1000 };
    const barMiddle: CandlestickBar = { date: 'd2', open: 58, high: 70, low: 55, close: 65, volume: 1000 };
    const barNewest: CandlestickBar = { date: 'd3', open: 65, high: 100, low: 60, close: 95, volume: 1000 };
    const result = computeFibonacciRetracement([barNewest, barMiddle, barOldest]); // newest-first
    expect(result?.swingHigh).toBe(100);
    expect(result?.swingLow).toBe(50);
    expect(result?.direction).toBe('down');
    const expectedPrices = [88.2, 80.9, 75, 69.1, 60.7];
    result?.levels.forEach((level, i) => expect(level.price).toBeCloseTo(expectedPrices[i]));
  });

  test('downtrend swing (high before low) retraces UP from the low', () => {
    const barOldest: CandlestickBar = { date: 'd1', open: 95, high: 100, low: 90, close: 98, volume: 1000 };
    const barMiddle: CandlestickBar = { date: 'd2', open: 90, high: 88, low: 70, close: 75, volume: 1000 };
    const barNewest: CandlestickBar = { date: 'd3', open: 75, high: 65, low: 50, close: 55, volume: 1000 };
    const result = computeFibonacciRetracement([barNewest, barMiddle, barOldest]); // newest-first
    expect(result?.swingHigh).toBe(100);
    expect(result?.swingLow).toBe(50);
    expect(result?.direction).toBe('up');
    expect(result?.levels[2]).toEqual({ pct: 0.5, price: 75 }); // swingLow + range*0.5 = 50+25
  });

  test('null when fewer than 2 bars are available', () => {
    expect(computeFibonacciRetracement([{ date: 'd1', open: 1, high: 1, low: 1, close: 1, volume: 1 }])).toBeNull();
  });
});

// closes newest-first, oldest -> newest a strictly increasing run [1,2,...,20] (mirrors
// momentum.service.test.ts's own mwRSI/mwSMA fixture convention).
const RISING_CLOSES = Array.from({ length: 20 }, (_, i) => 20 - i); // [20,19,...,1]

// A longer, non-monotonic deterministic series for the MACD cross-check (needs real EMA history
// to produce a meaningful signal line, not just a straight line).
const WAVY_CLOSES = Array.from({ length: 60 }, (_, i) => Math.round((100 + 10 * Math.sin(i / 5)) * 100) / 100);

describe('computeSmaSeries', () => {
  test('each point matches mwSMA computed independently over its own trailing window', () => {
    const series = computeSmaSeries(RISING_CLOSES, 5);
    expect(series[0]).toBe(mwSMA(RISING_CLOSES, 5)); // newest bar
    expect(series[3]).toBe(mwSMA(RISING_CLOSES.slice(3), 5)); // 4th-newest bar
  });

  test('null until enough closes exist for the period', () => {
    const series = computeSmaSeries(RISING_CLOSES, 5);
    expect(series[series.length - 1]).toBeNull(); // oldest bar - only 1 close behind it
    expect(series[series.length - 5]).not.toBeNull(); // exactly 5 closes behind it
  });
});

describe('computeBbSeries', () => {
  test('each point matches mwBB computed independently over its own trailing window', () => {
    const series = computeBbSeries(RISING_CLOSES, 5);
    expect(series[0]).toEqual(mwBB(RISING_CLOSES, 5));
  });

  test('null until enough closes exist for the period', () => {
    const series = computeBbSeries(RISING_CLOSES, 5);
    expect(series[series.length - 1]).toBeNull();
  });
});

describe('computeRsiSeries', () => {
  test('the newest point agrees with mwRSI\'s own single-value result', () => {
    const series = computeRsiSeries(RISING_CLOSES, 14);
    expect(series[0]).toBe(mwRSI(RISING_CLOSES, 14));
    expect(series[0]).toBe(100); // strictly rising, all gains - same fixture as momentum.service.test.ts
  });

  test('null for bars without enough trailing history, real values once the seed is complete', () => {
    // 20 bars, period 14: the seed needs 14 changes (15 bars), so the 6 newest bars (indices
    // 0-5, newest-first) get a real value and the remaining 14 (oldest, indices 6-19) stay null.
    const series = computeRsiSeries(RISING_CLOSES, 14);
    expect(series).toHaveLength(RISING_CLOSES.length);
    expect(series[5]).not.toBeNull(); // the seed point
    expect(series[6]).toBeNull(); // one bar further back - not enough history yet
    expect(series[series.length - 1]).toBeNull(); // oldest bar
  });

  test('all null when there isn\'t even enough history for one reading', () => {
    const series = computeRsiSeries([5, 4, 3], 14);
    expect(series).toEqual([null, null, null]);
  });
});

describe('computeMacdSeries', () => {
  test('the newest point agrees with mwMACD\'s own single-value result', () => {
    const series = computeMacdSeries(WAVY_CLOSES);
    const expected = mwMACD(WAVY_CLOSES);
    expect(series[0]?.macd).toBeCloseTo(expected.macd);
    expect(series[0]?.signal).toBeCloseTo(expected.signal);
    expect(series[0]?.hist).toBeCloseTo(expected.hist);
  });

  test('same length as the input, trailing entries null where there isn\'t enough EMA history yet', () => {
    const series = computeMacdSeries(WAVY_CLOSES);
    expect(series).toHaveLength(WAVY_CLOSES.length);
    expect(series[series.length - 1]).toBeNull();
  });
});
