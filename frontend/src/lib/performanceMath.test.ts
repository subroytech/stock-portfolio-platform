import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyOutlierFilter, calcCustomReturn, calcTabReturn, fmtMmDd } from './performanceMath';
import type { PerformanceBar } from './performanceMath';

// Newest-first bars, one per day, spanning well past 120 days so both
// trading-day and calendar-day branches have enough history to work with.
function makeBars(days: number, startClose = 100): PerformanceBar[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date('2026-07-20T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - i);
    return { date: date.toISOString().slice(0, 10), close: startClose + (days - i), low: startClose + (days - i) - 1 };
  });
}

describe('calcTabReturn', () => {
  // Calendar mode measures "N days ago" from the real Date.now(), not from
  // the fixture's own newest bar - pin the clock to the fixture's date range
  // so "30 days ago" lands predictably inside it instead of drifting with
  // whatever the real wall-clock date happens to be when this test runs.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('trading-day mode (<=15D) uses a direct array index, no date math', () => {
    const history = { AAPL: makeBars(30) };
    const { returnMap, startDate, endDate } = calcTabReturn(history, 5, false);
    const bars = history.AAPL;
    const expected = ((bars[0].close - bars[5].close) / bars[5].close) * 100;
    expect(returnMap.get('AAPL')).toBeCloseTo(expected, 6);
    expect(endDate).toBe(bars[0].date);
    expect(startDate).toBe(bars[5].date);
  });

  test('calendar-day mode (30D+) finds the closest trading day to N days ago, not a fixed index', () => {
    const history = { AAPL: makeBars(150) };
    const { returnMap } = calcTabReturn(history, 30, true);
    // Every day is present in this fixture, so calendar mode should land on
    // (approximately) the same bar trading-day mode would for a dense series.
    const bars = history.AAPL;
    const expected = ((bars[0].close - bars[30].close) / bars[30].close) * 100;
    expect(returnMap.get('AAPL')).toBeCloseTo(expected, 0);
  });

  test('skips a ticker with no history at all', () => {
    const { returnMap } = calcTabReturn({}, 5, false);
    expect(returnMap.size).toBe(0);
  });

  test('skips a ticker with too little history for the requested trading-day offset', () => {
    const history = { THIN: makeBars(3) };
    const { returnMap } = calcTabReturn(history, 5, false);
    expect(returnMap.has('THIN')).toBe(false);
  });

  test('computes independently across multiple tickers', () => {
    const history = { AAPL: makeBars(30, 100), MSFT: makeBars(30, 400) };
    const { returnMap } = calcTabReturn(history, 10, false);
    expect(returnMap.size).toBe(2);
    expect(returnMap.has('AAPL')).toBe(true);
    expect(returnMap.has('MSFT')).toBe(true);
  });
});

describe('calcCustomReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('uses trading-day mode for <=10 days, calendar mode for >10', () => {
    const history = { AAPL: makeBars(150) };
    const shortRun = calcCustomReturn(history, 7);
    const longRun = calcCustomReturn(history, 45);
    expect(shortRun.returnMap.get('AAPL')).toBeDefined();
    expect(longRun.returnMap.get('AAPL')).toBeDefined();
  });
});

describe('applyOutlierFilter', () => {
  function makeItems(returns: number[]): { id: string; ret: number }[] {
    return returns.map((ret, i) => ({ id: `S${i}`, ret }));
  }

  test('"all" mode returns everything with a value, sorted best to worst', () => {
    const items = makeItems([5, -3, 10, -1]);
    const result = applyOutlierFilter(items, (i) => i.ret, 'all');
    expect(result.map((i) => i.ret)).toEqual([10, 5, -1, -3]);
  });

  test('drops items with a null/undefined return value', () => {
    const items = [{ id: 'A', ret: 5 as number | null }, { id: 'B', ret: null }];
    const result = applyOutlierFilter(items, (i) => i.ret, 'all');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('A');
  });

  test('"outlier" mode caps at top 13 positives + top 12 negatives', () => {
    const positives = Array.from({ length: 20 }, (_, i) => 20 - i); // 20,19,...,1
    const negatives = Array.from({ length: 20 }, (_, i) => -(i + 1)); // -1,-2,...,-20
    const items = makeItems([...positives, ...negatives]);
    const result = applyOutlierFilter(items, (i) => i.ret, 'outlier');
    const posInResult = result.filter((i) => i.ret >= 0);
    const negInResult = result.filter((i) => i.ret < 0);
    expect(posInResult).toHaveLength(13);
    expect(negInResult).toHaveLength(12);
    // Top 13 positives (20 down to 8) and the 12 MOST negative (-9 down to -20).
    expect(posInResult.map((i) => i.ret)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8]);
    expect(negInResult.map((i) => i.ret)).toEqual([-9, -10, -11, -12, -13, -14, -15, -16, -17, -18, -19, -20]);
  });

  test('an all-positive portfolio under the caps shows every item, no negatives forced in', () => {
    const items = makeItems([3, 1, 2]);
    const result = applyOutlierFilter(items, (i) => i.ret, 'outlier');
    expect(result).toHaveLength(3);
    expect(result.every((i) => i.ret >= 0)).toBe(true);
  });
});

describe('fmtMmDd', () => {
  test('formats YYYY-MM-DD as Mmm-DD', () => {
    expect(fmtMmDd('2026-07-20')).toBe('Jul-20');
    expect(fmtMmDd('2026-01-05')).toBe('Jan-05');
    expect(fmtMmDd('2026-12-31')).toBe('Dec-31');
  });
});
