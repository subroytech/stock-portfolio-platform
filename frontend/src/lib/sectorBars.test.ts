import { describe, expect, it } from 'vitest';
import type { PortfolioHolding } from '../api/portfolios';
import type { PerformanceBar } from './performanceMath';
import {
  calcTrailingChange, fmtDollarTick, fmtSectorTotal, fmtSignedDollarK, fmtSignedPercent, getNextSectors, getTopSectors, hasNextSectors, isMarketOpenEastern,
} from './sectorBars';

function holding(overrides: Partial<PortfolioHolding> & { symbol: string }): PortfolioHolding {
  return {
    id: overrides.symbol,
    quantity: 10,
    currentPrice: 100,
    currentValue: 1000,
    sector: 'Tech',
    ...overrides,
  } as PortfolioHolding;
}

describe('getTopSectors', () => {
  it('ranks sectors by total value and keeps the top N', () => {
    const holdings = [
      holding({ symbol: 'A', sector: 'Energy', currentValue: 100 }),
      holding({ symbol: 'B', sector: 'Tech', currentValue: 500 }),
      holding({ symbol: 'C', sector: 'Tech', currentValue: 300 }),
      holding({ symbol: 'D', sector: 'Health', currentValue: 250 }),
    ];
    const top = getTopSectors(holdings, 2);
    expect(top.map((g) => g.sector)).toEqual(['Tech', 'Health']);
    expect(top[0].totalValue).toBe(800);
  });

  it('sorts holdings inside each sector by value, largest first', () => {
    const holdings = [
      holding({ symbol: 'SMALL', sector: 'Tech', currentValue: 100 }),
      holding({ symbol: 'BIG', sector: 'Tech', currentValue: 900 }),
    ];
    expect(getTopSectors(holdings)[0].holdings.map((h) => h.symbol)).toEqual(['BIG', 'SMALL']);
  });

  it('falls back to the symbol when a holding has no sector, like the By Sector pie', () => {
    const holdings = [holding({ symbol: 'IBIT', sector: null, currentValue: 50 })];
    expect(getTopSectors(holdings)[0].sector).toBe('IBIT');
  });

  it('caps at 6 sectors by default', () => {
    const holdings = Array.from({ length: 8 }, (_, i) => holding({ symbol: `S${i}`, sector: `Sector ${i}`, currentValue: i + 1 }));
    expect(getTopSectors(holdings)).toHaveLength(6);
  });
});

describe('calcTrailingChange', () => {
  // hist[0] is the most recent close, hist[N] is N trading days back.
  const hist: PerformanceBar[] = [
    { date: '2026-11-10', close: 110 },
    { date: '2026-11-07', close: 108 },
    { date: '2026-11-06', close: 106 },
    { date: '2026-11-05', close: 104 },
    { date: '2026-11-04', close: 102 },
    { date: '2026-11-03', close: 100 },
  ];

  it('market closed: compares the last close with the close N trading days back', () => {
    const h = holding({ symbol: 'X', quantity: 10, currentPrice: 999 });
    const change = calcTrailingChange(h, hist, 5, false);
    expect(change?.dollar).toBeCloseTo(10 * (110 - 100));
    expect(change?.percent).toBeCloseTo(10);
  });

  it('market open: uses the live price against the close N-1 trading days back (1D = today vs yesterday)', () => {
    const h = holding({ symbol: 'X', quantity: 10, currentPrice: 115 });
    const change = calcTrailingChange(h, hist, 1, true);
    expect(change?.dollar).toBeCloseTo(10 * (115 - 110));
    expect(change?.percent).toBeCloseTo((5 / 110) * 100);
  });

  it('returns null when there is no history for the symbol', () => {
    expect(calcTrailingChange(holding({ symbol: 'X' }), undefined, 5, false)).toBeNull();
  });

  it('returns null when the history is too short for the window', () => {
    const short = hist.slice(0, 3);
    expect(calcTrailingChange(holding({ symbol: 'X' }), short, 30, false)).toBeNull();
  });
});

describe('isMarketOpenEastern', () => {
  // 2026-11-16 is a Monday; US is on EST (UTC-5) by then.
  it('is open on a weekday at 10:00am ET', () => {
    expect(isMarketOpenEastern(new Date('2026-11-16T15:00:00Z'))).toBe(true);
  });
  it('is closed before the 9:30am ET open', () => {
    expect(isMarketOpenEastern(new Date('2026-11-16T14:00:00Z'))).toBe(false);
  });
  it('is closed at 4:00pm ET (session has ended)', () => {
    expect(isMarketOpenEastern(new Date('2026-11-16T21:00:00Z'))).toBe(false);
  });
  it('is closed on a Saturday even during the day', () => {
    expect(isMarketOpenEastern(new Date('2026-11-14T15:00:00Z'))).toBe(false);
  });
});

describe('fmtDollarTick', () => {
  it('formats thousands as k', () => {
    expect(fmtDollarTick(1000)).toBe('$1k');
    expect(fmtDollarTick(5000)).toBe('$5k');
    expect(fmtDollarTick(20000)).toBe('$20k');
  });
  it('keeps one decimal for non-round thousands', () => {
    expect(fmtDollarTick(2500)).toBe('$2.5k');
  });
  it('leaves values under 1000 in whole dollars', () => {
    expect(fmtDollarTick(500)).toBe('$500');
  });
  it('handles negatives', () => {
    expect(fmtDollarTick(-10000)).toBe('-$10k');
  });
});

describe('sector header formatters', () => {
  it('fmtSectorTotal shows the sector total in K with one decimal', () => {
    expect(fmtSectorTotal(168338.54)).toBe('$168.3K');
    expect(fmtSectorTotal(500)).toBe('$0.5K');
  });
  it('fmtSignedDollarK always carries a sign', () => {
    expect(fmtSignedDollarK(12345)).toBe('+$12.3K');
    expect(fmtSignedDollarK(-4500)).toBe('-$4.5K');
    expect(fmtSignedDollarK(0)).toBe('+$0.0K');
  });
  it('fmtSignedPercent always carries a sign, two decimals', () => {
    expect(fmtSignedPercent(1.234)).toBe('+1.23%');
    expect(fmtSignedPercent(-0.5)).toBe('-0.50%');
  });
});

describe('calcTrailingChange startValue', () => {
  it('reports quantity x start price so sector percent can be aggregated', () => {
    const hist: PerformanceBar[] = [{ date: 'd0', close: 110 }, { date: 'd1', close: 100 }];
    const change = calcTrailingChange(holding({ symbol: 'X', quantity: 10, currentPrice: 999 }), hist, 1, false);
    expect(change?.startValue).toBe(1000);
  });
});
describe('sector pages: top 6, 7-12, and top 12 (2026-11-16)', () => {
  // Builds `count` single-holding sectors, largest first: sector 1 is worth the most.
  function sectorHoldings(count: number): PortfolioHolding[] {
    return Array.from({ length: count }, (_, i) => holding({
      id: `h${i + 1}`, symbol: `S${i + 1}`, sector: `Sector ${i + 1}`, currentValue: (count - i) * 100,
    }));
  }

  it('getTopSectors returns the first six, getNextSectors the seventh through twelfth', () => {
    const holdings = sectorHoldings(10);
    expect(getTopSectors(holdings).map((g) => g.sector)).toEqual(['Sector 1', 'Sector 2', 'Sector 3', 'Sector 4', 'Sector 5', 'Sector 6']);
    expect(getNextSectors(holdings).map((g) => g.sector)).toEqual(['Sector 7', 'Sector 8', 'Sector 9', 'Sector 10']);
  });

  it('getTopSectors can return the top 12 for the summary pills', () => {
    expect(getTopSectors(sectorHoldings(15), 12)).toHaveLength(12);
  });

  it('hasNextSectors is true only when there is a seventh sector', () => {
    expect(hasNextSectors(sectorHoldings(6))).toBe(false);
    expect(hasNextSectors(sectorHoldings(7))).toBe(true);
    expect(getNextSectors(sectorHoldings(6))).toEqual([]);
  });
});
