import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import AllocationChart, { AllocationModeToggle } from './AllocationChart';
import type { PortfolioHolding } from '../api/portfolios';

function holding(overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    id: overrides.symbol ?? 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, purchasePrice: 100,
    currentPrice: 150, sector: 'Technology', purchaseDate: null, costBasis: 1000, currentValue: 1500,
    gainLoss: 500, returnPct: 50, allocationPct: 100, priceUpdatedAt: null,
    todayChangeDollar: null, todayChangePercent: null,
    ...overrides,
  };
}

describe('AllocationModeToggle', () => {
  test('highlights the active mode and calls onChange with the clicked mode', async () => {
    const onChange = vi.fn();
    render(<AllocationModeToggle mode="sector" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'By Sector' })).toHaveClass('bg-accent');
    expect(screen.getByRole('button', { name: 'By Stock' })).not.toHaveClass('bg-accent');

    await userEvent.click(screen.getByRole('button', { name: 'By Stock' }));
    expect(onChange).toHaveBeenCalledWith('stock');

    await userEvent.click(screen.getByRole('button', { name: "Today's $" }));
    expect(onChange).toHaveBeenCalledWith('todayDollar');
  });
});

describe('AllocationChart', () => {
  test('shows an empty-state message when there are no holdings', () => {
    render(<AllocationChart holdings={[]} mode="sector" />);
    expect(screen.getByText(/no holdings to chart yet/i)).toBeInTheDocument();
  });

  test('By Sector mode groups holdings by sector, shown via a single-column side legend', () => {
    const holdings = [
      holding({ id: 'h1', symbol: 'AAPL', sector: 'Technology', currentValue: 1000 }),
      holding({ id: 'h2', symbol: 'MSFT', sector: 'Technology', currentValue: 500 }),
      holding({ id: 'h3', symbol: 'JPM', sector: 'Financials', currentValue: 300 }),
    ];
    render(<AllocationChart holdings={holdings} mode="sector" />);
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('Financials')).toBeInTheDocument();
  });

  test('falls back to the symbol as the group key when sector is unknown', () => {
    const holdings = [holding({ symbol: 'ZZZZ', sector: null })];
    render(<AllocationChart holdings={holdings} mode="sector" />);
    expect(screen.getByText('ZZZZ')).toBeInTheDocument();
  });

  test('By Stock mode groups holdings by symbol, shown via a 2-column side legend', () => {
    const holdings = [holding({ symbol: 'AAPL' }), holding({ id: 'h2', symbol: 'MSFT' })];
    render(<AllocationChart holdings={holdings} mode="stock" />);
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    expect(screen.getByText('MSFT')).toBeInTheDocument();
  });

  test('Today\'s $ mode prompts for a refresh when no holding has a persisted todayChangeDollar yet', () => {
    render(<AllocationChart holdings={[holding()]} mode="todayDollar" />);
    expect(screen.getByText(/no today.s \$ data yet/i)).toBeInTheDocument();
  });

  test('Today\'s $ mode splits holdings into Gainers/Losers with $ totals, reading todayChangeDollar straight off holdings (no refresh needed this session)', () => {
    const holdings = [
      holding({ symbol: 'AAPL', todayChangeDollar: 300, todayChangePercent: 2, priceUpdatedAt: '2026-07-15T10:00:00Z' }),
      holding({ id: 'h2', symbol: 'MSFT', todayChangeDollar: -100, todayChangePercent: -1, priceUpdatedAt: '2026-07-15T10:00:00Z' }),
      holding({ id: 'h3', symbol: 'TSLA', todayChangeDollar: null, todayChangePercent: null }),
    ];
    render(<AllocationChart holdings={holdings} mode="todayDollar" />);
    expect(screen.getByText(/Gainers · \$300/)).toBeInTheDocument();
    expect(screen.getByText(/Losers · \$-100/)).toBeInTheDocument();
    expect(screen.getByText(/As of/i)).toBeInTheDocument();
  });

  test('Today\'s $ totals render as whole integers, never with decimal places', () => {
    const holdings = [
      holding({ symbol: 'AAPL', todayChangeDollar: 300.75, todayChangePercent: 2 }),
      holding({ id: 'h2', symbol: 'MSFT', todayChangeDollar: -100.25, todayChangePercent: -1 }),
    ];
    render(<AllocationChart holdings={holdings} mode="todayDollar" />);
    expect(screen.getByText('Gainers · $301')).toBeInTheDocument();
    expect(screen.getByText('Losers · $-100')).toBeInTheDocument();
  });

  test('Today\'s $ shows a real ticker legend (not on-slice labels), capped to the top 10 per side by magnitude, while the header total still reflects everyone', () => {
    const holdings = [
      ...Array.from({ length: 12 }, (_, i) => holding({ id: `g${i}`, symbol: `G${i}`, todayChangeDollar: 100 - i, todayChangePercent: 1 })),
      ...Array.from({ length: 12 }, (_, i) => holding({ id: `l${i}`, symbol: `L${i}`, todayChangeDollar: -(100 - i), todayChangePercent: -1 })),
    ];
    render(<AllocationChart holdings={holdings} mode="todayDollar" />);

    // Legend shows the top 10 gainers/losers by magnitude (G0-G9, L0-L9),
    // not the 11th/12th smallest movers (G10/G11, L10/L11).
    expect(screen.getByText('G0')).toBeInTheDocument();
    expect(screen.getByText('G9')).toBeInTheDocument();
    expect(screen.queryByText('G10')).not.toBeInTheDocument();
    expect(screen.getByText('L0')).toBeInTheDocument();
    expect(screen.getByText('L9')).toBeInTheDocument();
    expect(screen.queryByText('L10')).not.toBeInTheDocument();

    // Header totals sum ALL 12 gainers/losers, not just the visible top 10.
    // formatWholeCurrency adds thousands separators (toLocaleString), so
    // 1134 renders as "1,134".
    expect(screen.getByText(/Gainers · \$1,134/)).toBeInTheDocument();
    expect(screen.getByText(/Losers · \$-1,134/)).toBeInTheDocument();
  });

  test('caps sector/stock groups at 19 entries, aggregating the rest into "Other"', () => {
    const holdings = Array.from({ length: 25 }, (_, i) => holding({ id: `h${i}`, symbol: `S${i}`, sector: `Sector${i}`, currentValue: 25 - i }));
    render(<AllocationChart holdings={holdings} mode="sector" />);
    // 25 distinct sectors capped to 19 + "Other" = 20 legend entries.
    expect(screen.getAllByText(/^Sector\d+$/)).toHaveLength(19);
    expect(screen.getByText('Other')).toBeInTheDocument();
  });
});
