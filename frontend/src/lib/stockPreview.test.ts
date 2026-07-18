import { describe, expect, test } from 'vitest';
import { buildChartSeries, computeReturns, type HistoricalBar } from './stockPreview';

// data is newest-first, matching the backend's /stock-preview response.
function makeBars(count: number, startPrice: number, step: number): HistoricalBar[] {
  const today = new Date('2026-07-13');
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), close: startPrice - i * step };
  });
}

describe('computeReturns', () => {
  test('market closed: today compares the two most recent closes', () => {
    const data = makeBars(10, 100, 1); // closes: 100, 99, 98, ...
    const r = computeReturns(data, 100, false);
    expect(r.today).toBeCloseTo((100 - 99) / 99 * 100, 6);
  });

  test('market open: today compares the live price against yesterday\'s close', () => {
    const data = makeBars(10, 100, 1);
    const r = computeReturns(data, 105, true);
    expect(r.today).toBeCloseTo((105 - 100) / 100 * 100, 6);
  });

  test('returns null for a window past the end of the data', () => {
    const data = makeBars(5, 100, 1);
    const r = computeReturns(data, 100, true);
    expect(r.d90).toBeNull();
  });
});

describe('buildChartSeries', () => {
  test('when the market is open, appends the live price as a "Live" point', () => {
    const data = makeBars(30, 100, 1);
    const series = buildChartSeries(data, 105, true);
    expect(series.chartPrices.at(-1)).toBe(105);
    expect(series.rawDates.at(-1)).toBe('Live');
  });

  test('when the market is closed, the series ends at the last close, labeled "C"', () => {
    const data = makeBars(30, 100, 1);
    const series = buildChartSeries(data, 100, false);
    expect(series.chartPrices.at(-1)).toBe(100); // most recent close (index 0, oldest-first reversal puts it last)
    expect(series.labels.at(-1)).toBe('C');
  });

  test('prices are returned oldest-first (chart x-axis reads left-to-right forward in time)', () => {
    const data = makeBars(5, 100, 1); // newest-first: 100, 99, 98, 97, 96
    const series = buildChartSeries(data, 100, false);
    expect(series.chartPrices).toEqual([96, 97, 98, 99, 100]);
  });
});
