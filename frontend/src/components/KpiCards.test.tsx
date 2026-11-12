import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import KpiCards from './KpiCards';
import type { PortfolioDetail, PortfolioHolding } from '../api/portfolios';

function makeHolding(overrides: Partial<PortfolioHolding>): PortfolioHolding {
  return {
    id: overrides.id ?? 'h1',
    symbol: overrides.symbol ?? 'AAPL',
    name: null,
    quantity: 10,
    purchasePrice: 100,
    currentPrice: 150,
    sector: null,
    purchaseDate: null,
    costBasis: 1000,
    currentValue: 1500,
    gainLoss: 500,
    returnPct: 50,
    allocationPct: null,
    priceUpdatedAt: null,
    todayChangeDollar: null,
    todayChangePercent: null,
    ...overrides,
  };
}

function makePortfolio(holdings: PortfolioHolding[]): PortfolioDetail {
  const totalHoldingsValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCostBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
  return {
    id: 'p1',
    name: 'Test Portfolio',
    broker: null,
    createdAt: '',
    updatedAt: '',
    uploadTemplateId: null,
    flexTemplateStatus: null,
    cashAmount: 0,
    holdings,
    totalHoldingsValue,
    totalCostBasis,
    totalGainLoss: totalHoldingsValue - totalCostBasis,
    totalPortfolioValue: totalHoldingsValue,
  };
}

describe('KpiCards', () => {
  test('renders the 4 base KPI cards', () => {
    const portfolio = makePortfolio([makeHolding({})]);
    render(<KpiCards portfolio={portfolio} />);
    expect(screen.getByTestId('kpi-total-value')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-holdings-value')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-cash')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-gain-loss')).toBeInTheDocument();
  });

  test('shows dash/None placeholders for the "today" pills when no holding has been refreshed yet - all 8 still render on one line', () => {
    const portfolio = makePortfolio([makeHolding({ todayChangeDollar: null })]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-today-dollar')).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-today-percent')).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-top-gainer')).getByText('None')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-top-loser')).getByText('None')).toBeInTheDocument();
    // Neutral, not green/red, since there's no real sign to show yet.
    expect(screen.getByTestId('kpi-today-dollar')).toHaveClass('text-text-secondary');
  });

  test('computes Today\'s $ as the sum of todayChangeDollar across holdings', () => {
    const portfolio = makePortfolio([
      makeHolding({ id: 'h1', symbol: 'AAPL', currentValue: 1500, todayChangeDollar: 100 }),
      makeHolding({ id: 'h2', symbol: 'MSFT', currentValue: 2000, todayChangeDollar: -40 }),
    ]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-today-dollar')).getByText('$60.00')).toBeInTheDocument();
  });

  test("Today's $ is colored green when positive, red when negative", () => {
    const positive = makePortfolio([makeHolding({ todayChangeDollar: 50, currentValue: 1000 })]);
    const { unmount } = render(<KpiCards portfolio={positive} />);
    expect(screen.getByTestId('kpi-today-dollar')).toHaveClass('text-success');
    unmount();

    const negative = makePortfolio([makeHolding({ todayChangeDollar: -50, currentValue: 1000 })]);
    render(<KpiCards portfolio={negative} />);
    expect(screen.getByTestId('kpi-today-dollar')).toHaveClass('text-danger');
  });

  test("Today's % is today's $ relative to yesterday's value (currentValue minus today's own change)", () => {
    // currentValue 1100, todayChangeDollar 100 -> yesterday's value was 1000 -> +10%.
    const portfolio = makePortfolio([makeHolding({ currentValue: 1100, todayChangeDollar: 100 })]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-today-percent')).getByText('+10.00%')).toBeInTheDocument();
  });

  test('a holding that has never been refreshed still contributes to the % base, via its own currentValue', () => {
    const portfolio = makePortfolio([
      makeHolding({ id: 'h1', currentValue: 1100, todayChangeDollar: 100 }), // yesterday: 1000
      makeHolding({ id: 'h2', symbol: 'MSFT', currentValue: 500, todayChangeDollar: null }), // yesterday: 500 (unchanged)
    ]);
    render(<KpiCards portfolio={portfolio} />);
    // today $ = 100, yesterday total = 1000 + 500 = 1500 -> 6.67%
    expect(within(screen.getByTestId('kpi-today-percent')).getByText('+6.67%')).toBeInTheDocument();
  });

  test('Top Gainer and Top Loser identify the largest positive and most negative movers', () => {
    const portfolio = makePortfolio([
      makeHolding({ id: 'h1', symbol: 'AAPL', todayChangeDollar: 50 }),
      makeHolding({ id: 'h2', symbol: 'MSFT', todayChangeDollar: 150 }),
      makeHolding({ id: 'h3', symbol: 'TSLA', todayChangeDollar: -30 }),
      makeHolding({ id: 'h4', symbol: 'NFLX', todayChangeDollar: -200 }),
    ]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-top-gainer')).getByText(/MSFT/)).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-top-gainer')).getByText(/\$150\.00/)).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-top-loser')).getByText(/NFLX/)).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-top-loser')).getByText(/-\$200\.00/)).toBeInTheDocument();
  });

  test('Top Gainer shows "None" when every refreshed holding is flat or down', () => {
    const portfolio = makePortfolio([makeHolding({ todayChangeDollar: -10 })]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-top-gainer')).getByText('None')).toBeInTheDocument();
  });

  test('Top Loser shows "None" when every refreshed holding is flat or up', () => {
    const portfolio = makePortfolio([makeHolding({ todayChangeDollar: 10 })]);
    render(<KpiCards portfolio={portfolio} />);
    expect(within(screen.getByTestId('kpi-top-loser')).getByText('None')).toBeInTheDocument();
  });
});
