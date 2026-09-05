import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import PerformanceChart from './PerformanceChart';
import type { PortfolioHolding, RefreshPricesResult } from '../api/portfolios';

function holding(overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    id: overrides.symbol ?? 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, purchasePrice: 100,
    currentPrice: 150, sector: 'Technology', purchaseDate: null, costBasis: 1000, currentValue: 1500,
    gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null,
    todayChangeDollar: null, todayChangePercent: null,
    ...overrides,
  };
}

// Newest-first bars, one per day - enough history to cover all fixed tabs (1D-120D).
function makeBars(days: number, startClose = 100) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date('2026-07-20T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - i);
    return { date: date.toISOString().slice(0, 10), close: startClose + (days - i), low: startClose + (days - i) - 1 };
  });
}

describe('PerformanceChart', () => {
  test('shows an empty-state message when there are no holdings', () => {
    render(<PerformanceChart holdings={[]} />);
    expect(screen.getByText(/no holdings to chart yet/i)).toBeInTheDocument();
  });

  test('without a refreshResult AND no persisted todayChangeDollar, falls back to the static total-gain/loss view with a prompt', () => {
    render(<PerformanceChart holdings={[holding()]} />);
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Click Refresh Prices above for period returns (1D-120D), an Outlier view, and a Today’s $ mode.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1D' })).not.toBeInTheDocument();
  });

  test('Today ($) is reachable with persisted todayChangeDollar alone, with no refreshResult and no click needed this session', async () => {
    const holdings = [holding({ todayChangeDollar: 42, todayChangePercent: 3, priceUpdatedAt: '2026-07-15T10:00:00Z' })];
    render(<PerformanceChart holdings={holdings} />);
    // Defaults straight to the Today ($) tab since that's the only data available.
    expect(screen.getByRole('button', { name: 'Today ($)' })).toHaveClass('bg-accent');
    expect(screen.getByText(/As of/i)).toBeInTheDocument();
  });

  test('period tabs (1D-120D) show a "click Refresh Prices" prompt when only todayChangeDollar is available, not performanceHistory', async () => {
    const holdings = [holding({ todayChangeDollar: 42, todayChangePercent: 3 })];
    render(<PerformanceChart holdings={holdings} />);
    await userEvent.click(screen.getByRole('button', { name: '5D' }));
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Click Refresh Prices above to fetch period history for this tab.')).toBeInTheDocument();
  });

  test('once a refreshResult exists, the period-tab strip and Outlier/All toggle appear, defaulting to 1D + Outlier', () => {
    const refreshResult: RefreshPricesResult = {
      holdings: [{ id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: 10, todayChangePercent: 1 }],
      performanceHistory: { AAPL: makeBars(30) },
    };
    render(<PerformanceChart holdings={[holding()]} refreshResult={refreshResult} />);
    expect(screen.getByRole('button', { name: '1D' })).toHaveClass('bg-accent');
    expect(screen.getByRole('button', { name: 'Outlier' })).toHaveClass('bg-accent');
    expect(screen.getByText(/from.*\(close\) to.*\(close\)/i)).toBeInTheDocument();
  });

  test('switching to the Custom tab shows a day-count input', async () => {
    const refreshResult: RefreshPricesResult = {
      holdings: [{ id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: 10, todayChangePercent: 1 }],
      performanceHistory: { AAPL: makeBars(150) },
    };
    render(<PerformanceChart holdings={[holding()]} refreshResult={refreshResult} />);
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText(/days/i)).toBeInTheDocument();
  });

  test('Today ($) tab uses todayChangeDollar off holdings instead of the history-derived return', async () => {
    const holdings = [holding({ todayChangeDollar: 42, todayChangePercent: 3 })];
    const refreshResult: RefreshPricesResult = {
      holdings: [{ id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: 42, todayChangePercent: 3 }],
      performanceHistory: { AAPL: makeBars(30) },
    };
    render(<PerformanceChart holdings={holdings} refreshResult={refreshResult} />);
    await userEvent.click(screen.getByRole('button', { name: 'Today ($)' }));
    expect(screen.getByRole('button', { name: 'Today ($)' })).toHaveClass('bg-accent');
  });

  test('a ticker missing from performanceHistory is excluded from the period-return chart, not shown as zero', () => {
    const refreshResult: RefreshPricesResult = {
      holdings: [
        { id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: null, todayChangePercent: null },
        { id: 'h2', symbol: 'BTC', currentPrice: 30000, currentValue: 30000, gainLoss: 0, returnPct: 0, allocationPct: 0, priceUpdatedAt: null, todayChangeDollar: null, todayChangePercent: null },
      ],
      performanceHistory: { AAPL: makeBars(30) }, // BTC excluded (crypto), matching the backend's isPerfSkipped
    };
    const holdings = [holding({ symbol: 'AAPL' }), holding({ id: 'h2', symbol: 'BTC', sector: 'Crypto' })];
    render(<PerformanceChart holdings={holdings} refreshResult={refreshResult} />);
    // No crash, and the 1D tab (default) renders using only AAPL's real history.
    expect(screen.getByRole('button', { name: '1D' })).toHaveClass('bg-accent');
  });

  test('toggling to "All" is reflected in the toggle state', async () => {
    const refreshResult: RefreshPricesResult = {
      holdings: [{ id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: 10, todayChangePercent: 1 }],
      performanceHistory: { AAPL: makeBars(30) },
    };
    render(<PerformanceChart holdings={[holding()]} refreshResult={refreshResult} />);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: 'All' })).toHaveClass('bg-accent');
    expect(screen.getByRole('button', { name: 'Outlier' })).not.toHaveClass('bg-accent');
  });
});
