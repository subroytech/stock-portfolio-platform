import { applyLivePrices, computeGroupGain, HoldingLike } from '../src/services/livePrices.service';
import { Quote } from '../src/services/marketData.service';

function holding(overrides: Partial<HoldingLike> = {}): HoldingLike {
  return {
    symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology',
    quantity: 10, purchasePrice: 100, currentPrice: 100,
    costBasis: 1000, currentValue: 1000, gainLoss: 0, returnPct: 0, allocation: 100,
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return { price: 0, changeDollar: 0, changePercent: 0, name: '', isActivelyTrading: true, ...overrides };
}

describe('applyLivePrices', () => {
  test('updates currentPrice/currentValue/gainLoss/returnPct from the price map', () => {
    const holdings = [holding()];
    const { updated } = applyLivePrices(holdings, { AAPL: quote({ price: 120, changeDollar: 2, changePercent: 1.7, name: 'Apple' }) });
    expect(updated).toBe(1);
    expect(holdings[0].currentPrice).toBe(120);
    expect(holdings[0].currentValue).toBe(1200);
    expect(holdings[0].gainLoss).toBe(200);
    expect(holdings[0].returnPct).toBeCloseTo(20, 6);
  });

  test('recomputes allocation% across all holdings after price updates', () => {
    const holdings = [
      holding({ symbol: 'AAPL', quantity: 10, currentValue: 1000 }),
      holding({ symbol: 'MSFT', quantity: 10, currentValue: 1000 }),
    ];
    applyLivePrices(holdings, { AAPL: quote({ price: 300 }) }); // AAPL -> 3000, MSFT stays 1000
    expect(holdings[0].allocation).toBeCloseTo(75, 6);
    expect(holdings[1].allocation).toBeCloseTo(25, 6);
  });

  test('leaves holdings with no price-map entry untouched and not counted in updated', () => {
    const holdings = [holding({ symbol: 'AAPL' }), holding({ symbol: 'TSLA', currentPrice: 50 })];
    const { updated } = applyLivePrices(holdings, { AAPL: quote({ price: 110 }) });
    expect(updated).toBe(1);
    expect(holdings[1].currentPrice).toBe(50);
  });

  test('filters by query across symbol/name/sector, case-insensitively', () => {
    const holdings = [
      holding({ symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' }),
      holding({ symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financials' }),
    ];
    const { filtered } = applyLivePrices(holdings, {}, 'financials');
    expect(filtered.map((d) => d.symbol)).toEqual(['JPM']);
  });
});

describe('computeGroupGain', () => {
  test('sums shares * changeDollar only for holdings present in the price map', () => {
    const holdings = [
      holding({ symbol: 'AAPL', currentValue: 1200 }), // 10 shares implied by quantity, but uses currentValue/price for shares
      holding({ symbol: 'TSLA', currentValue: 500 }),
    ];
    const priceMap: Record<string, Quote> = { AAPL: { price: 120, changeDollar: 2, changePercent: 0, name: '', isActivelyTrading: true } }; // TSLA absent -> excluded
    const { gainDollars, covered } = computeGroupGain(holdings, priceMap);
    expect(covered).toHaveLength(1);
    // shares = currentValue / price = 1200/120 = 10; gain = 10 * 2 = 20
    expect(gainDollars).toBeCloseTo(20, 6);
  });

  test('returns zero gain when no holdings are covered by the price map', () => {
    const holdings = [holding({ symbol: 'AAPL' })];
    const { gainDollars, covered } = computeGroupGain(holdings, {});
    expect(gainDollars).toBe(0);
    expect(covered).toHaveLength(0);
  });
});
