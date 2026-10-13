import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  todayChangeDollar: null,
  todayChangePercent: null,
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
    // "Value▼" - Value is the default sort column (descending) - see the dedicated sort-default test.
    expect(headers).toEqual([
      'Symbol', 'Name', 'Sector', 'Qty', 'Avg Cost', 'Price', 'Value▼', 'Gain/Loss', 'Return %', 'Alloc %',
    ]);
  });

  function rowOrder() {
    return screen.getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));
  }

  test('sorted by Value descending by default (not insertion order)', () => {
    const holdings = [
      { ...holding, id: 'h1', symbol: 'MSFT', currentValue: 500 },
      { ...holding, id: 'h2', symbol: 'AAPL', currentValue: 1500 },
      { ...holding, id: 'h3', symbol: 'GOOG', currentValue: 1000 },
    ];
    render(<HoldingsTable holdings={holdings} />);
    expect(rowOrder()).toEqual(['holdings-row-AAPL', 'holdings-row-GOOG', 'holdings-row-MSFT']);
  });

  test('clicking a column header sorts ascending; clicking it again reverses to descending', async () => {
    const holdings = [
      { ...holding, id: 'h1', symbol: 'MSFT', currentValue: 500 },
      { ...holding, id: 'h2', symbol: 'AAPL', currentValue: 1500 },
      { ...holding, id: 'h3', symbol: 'GOOG', currentValue: 1000 },
    ];
    render(<HoldingsTable holdings={holdings} />);

    await userEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    expect(rowOrder()).toEqual(['holdings-row-AAPL', 'holdings-row-GOOG', 'holdings-row-MSFT']);

    await userEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    expect(rowOrder()).toEqual(['holdings-row-MSFT', 'holdings-row-GOOG', 'holdings-row-AAPL']);
  });

  test('switching to a different column sorts ascending on the new column (not carrying over the old direction)', async () => {
    const holdings = [
      { ...holding, id: 'h1', symbol: 'MSFT', currentValue: 500 },
      { ...holding, id: 'h2', symbol: 'AAPL', currentValue: 1500 },
      { ...holding, id: 'h3', symbol: 'GOOG', currentValue: 1000 },
    ];
    render(<HoldingsTable holdings={holdings} />);

    await userEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    await userEvent.click(screen.getByRole('button', { name: 'Symbol' })); // now descending on Symbol
    await userEvent.click(screen.getByRole('button', { name: 'Value' })); // switch column - resets to ascending
    expect(rowOrder()).toEqual(['holdings-row-MSFT', 'holdings-row-GOOG', 'holdings-row-AAPL']); // 500, 1000, 1500
  });

  test('nulls sort last in both directions', async () => {
    const holdings = [
      { ...holding, id: 'h1', symbol: 'AAA', sector: 'Tech' },
      { ...holding, id: 'h2', symbol: 'BBB', sector: null },
      { ...holding, id: 'h3', symbol: 'CCC', sector: 'Finance' },
    ];
    render(<HoldingsTable holdings={holdings} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sector' }));
    expect(rowOrder()).toEqual(['holdings-row-CCC', 'holdings-row-AAA', 'holdings-row-BBB']);

    await userEvent.click(screen.getByRole('button', { name: 'Sector' })); // descending
    expect(rowOrder()).toEqual(['holdings-row-AAA', 'holdings-row-CCC', 'holdings-row-BBB']); // null still last
  });

  describe('Major/Minor Holdings tabs', () => {
    function sizedHoldings() {
      return [
        { ...holding, id: 'h1', symbol: 'BIG', allocationPct: 40 },
        { ...holding, id: 'h2', symbol: 'SMALL', allocationPct: 1 },
        { ...holding, id: 'h3', symbol: 'EDGE', allocationPct: 2.5 }, // exactly at the threshold - minor, not major
        { ...holding, id: 'h4', symbol: 'UNKNOWN', allocationPct: null }, // no price refresh yet - defaults to MAJOR (see below)
      ];
    }

    test('defaults to the Major tab, showing allocations > 2.5% PLUS unknown (null) allocations, with a correct count and $ total', () => {
      render(<HoldingsTable holdings={sizedHoldings()} />);
      expect(screen.getByRole('button', { name: 'MAJOR ($3,000.00) in #2 Stocks' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'MINOR ($3,000.00) in #2 Stocks' })).toBeInTheDocument();
      expect(screen.getAllByText('BIG').length).toBeGreaterThan(0);
      expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThan(0);
      expect(screen.queryByText('SMALL')).not.toBeInTheDocument();
      expect(screen.queryByText('EDGE')).not.toBeInTheDocument();
    });

    test('switching to Minor shows only real allocations <= 2.5% (including exactly-2.5%), never null ones', async () => {
      render(<HoldingsTable holdings={sizedHoldings()} />);
      await userEvent.click(screen.getByRole('button', { name: /^MINOR/ }));

      expect(screen.getAllByText('SMALL').length).toBeGreaterThan(0);
      expect(screen.getAllByText('EDGE').length).toBeGreaterThan(0);
      expect(screen.queryByText('BIG')).not.toBeInTheDocument();
      expect(screen.queryByText('UNKNOWN')).not.toBeInTheDocument();
    });

    // Regression test: found live via the E2E golden-path scenario (2026-08-03) - a fresh
    // CSV import never sets allocation_pct (only refreshPrices() ever computes it), so right
    // after import every holding has a null allocationPct. The old ?? 0 default bucketed all
    // of them into Minor, meaning a brand-new portfolio showed "0 stocks" in the default
    // (Major) tab until the user thought to click Refresh Prices - a real usability
    // regression, not just a test-fixture mismatch.
    test('a portfolio where every holding has a null allocationPct (fresh import, no refresh yet) shows them all in Major, not hidden in Minor', () => {
      const freshImport = [
        { ...holding, id: 'h1', symbol: 'AAPL', allocationPct: null },
        { ...holding, id: 'h2', symbol: 'MSFT', allocationPct: null },
      ];
      render(<HoldingsTable holdings={freshImport} />);
      expect(screen.getByRole('button', { name: /^MAJOR.*#2 Stocks/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^MINOR.*#0 Stocks/ })).toBeInTheDocument();
      expect(screen.getByTestId('holdings-row-AAPL')).toBeInTheDocument();
      expect(screen.getByTestId('holdings-row-MSFT')).toBeInTheDocument();
    });

    test('shows a tab-specific empty state when the active tab has no matching holdings', async () => {
      render(<HoldingsTable holdings={[{ ...holding, id: 'h1', symbol: 'BIG', allocationPct: 40 }]} />);
      expect(screen.queryByText(/No holdings/)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^MINOR/ }));
      expect(screen.getByText(/No holdings at or below the 2.5% allocation threshold/)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });
});
