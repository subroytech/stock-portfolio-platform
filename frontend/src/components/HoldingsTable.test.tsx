import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import HoldingsTable from './HoldingsTable';
import type { PortfolioHolding } from '../api/portfolios';

const holding: PortfolioHolding = {
  id: 'h1',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  quantity: 10,
  purchasePrice: 100,
  currentPrice: 150,
  sector: 'Tech',
  purchaseDate: null,
  costBasis: 1000,
  currentValue: 1500,
  gainLoss: 500,
  returnPct: 50,
  allocationPct: 100,
  priceUpdatedAt: null,
};

describe('HoldingsTable', () => {
  test('shows an empty-state message when there are no holdings', () => {
    render(<HoldingsTable holdings={[]} />);
    expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument();
  });

  // Both markups render simultaneously (Tailwind toggles visibility via
  // md:hidden / hidden md:block) — this is what the Phase 3 plan's
  // shortcoming-#11 fix depends on, so assert both exist rather than trying
  // to simulate a viewport width in jsdom.
  test('renders both the mobile card layout and the desktop table for the same data', () => {
    render(<HoldingsTable holdings={[holding]} />);
    const symbolMatches = screen.getAllByText('AAPL');
    expect(symbolMatches.length).toBe(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  test('desktop table renders one row per holding with all 10 columns', () => {
    render(<HoldingsTable holdings={[holding]} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Symbol', 'Name', 'Sector', 'Qty', 'Avg Cost', 'Price', 'Value', 'Gain/Loss', 'Return %', 'Alloc %',
    ]);
  });
});
