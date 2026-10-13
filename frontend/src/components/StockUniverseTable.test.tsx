import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import StockUniverseTable from './StockUniverseTable';
import type { UniverseTable } from '../api/contrarianFinder';

// Symbols deliberately chosen so alphabetical order (APPLE, MID, ZEBRA) is the
// REVERSE of index-count-descending order (ZEBRA, MID, APPLE) - otherwise a
// test that clicks "Symbol" to re-sort couldn't tell the two orderings apart.
const universeData: UniverseTable = {
  indices: [
    { id: 'DJ30', description: 'Dow Jones Industrial Average' },
    { id: 'SP500', description: 'S&P 500 Index' },
    { id: 'XLK', description: 'Technology Select Sector SPDR Fund' },
  ],
  stocks: [
    { symbol: 'ZEBRA', name: 'Zebra Corp', sector: 'Technology', marketCap: 3_000_000_000_000, indices: ['DJ30', 'SP500', 'XLK'] },
    { symbol: 'MID', name: 'Mid Co', sector: 'Finance', marketCap: 2_500_000_000, indices: ['DJ30', 'SP500'] },
    { symbol: 'APPLE', name: null, sector: null, marketCap: null, indices: ['SP500'] },
  ],
};

function rowOrder() {
  return screen.getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));
}

describe('StockUniverseTable', () => {
  test('defaults to index-count-descending sort, with a Srl# column and a tick per index the stock belongs to', () => {
    render(<StockUniverseTable data={universeData} />);
    expect(rowOrder()).toEqual(['universe-row-ZEBRA', 'universe-row-MID', 'universe-row-APPLE']); // 3, 2, 1

    const zebraCells = Array.from(screen.getByTestId('universe-row-ZEBRA').querySelectorAll('td')).map((td) => td.textContent);
    expect(zebraCells).toEqual(['1', 'ZEBRA', 'Zebra Corp', '$3T', 'Technology', '3', '✓', '✓', '✓']);

    const appleCells = Array.from(screen.getByTestId('universe-row-APPLE').querySelectorAll('td')).map((td) => td.textContent);
    expect(appleCells).toEqual(['3', 'APPLE', '—', '—', '—', '1', '', '✓', '']); // only SP500 ticked, no name/sector/market cap

    // Srl# reflects display position (1-indexed), not a stable per-stock id.
    expect(screen.getByText('Srl#')).toBeInTheDocument();
  });

  test('renders both the mobile card layout (only ticked indices shown) and the desktop table', () => {
    render(<StockUniverseTable data={universeData} />);
    expect(screen.getAllByText('ZEBRA').length).toBe(2); // mobile card + desktop row
    expect(screen.getByRole('table')).toBeInTheDocument();

    expect(within(screen.getByTestId('universe-card-ZEBRA')).getByText('DJ30 · SP500 · XLK')).toBeInTheDocument();
    expect(within(screen.getByTestId('universe-card-APPLE')).getByText('SP500')).toBeInTheDocument(); // only one ticked - no dots
  });

  test('search filters by symbol or name', async () => {
    render(<StockUniverseTable data={universeData} />);
    await userEvent.type(screen.getByLabelText('Search stock universe'), 'mid');
    expect(screen.getAllByText('MID').length).toBeGreaterThan(0);
    expect(screen.queryByText('ZEBRA')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 stocks')).toBeInTheDocument();
  });

  test('shows an empty state when the search matches nothing', async () => {
    render(<StockUniverseTable data={universeData} />);
    await userEvent.type(screen.getByLabelText('Search stock universe'), 'nonexistent');
    expect(screen.getByText('No stocks match your search.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('clicking the Symbol header switches off the default index-count sort', async () => {
    render(<StockUniverseTable data={universeData} />);
    await userEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    expect(rowOrder()).toEqual(['universe-row-APPLE', 'universe-row-MID', 'universe-row-ZEBRA']); // alphabetical, reversed from default
  });

  test('Srl# renumbers 1-2-3 by display position after re-sorting, not a stable per-stock id', async () => {
    render(<StockUniverseTable data={universeData} />);
    await userEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    const firstCellOf = (symbol: string) => screen.getByTestId(`universe-row-${symbol}`).querySelector('td')?.textContent;
    expect(firstCellOf('APPLE')).toBe('1');
    expect(firstCellOf('MID')).toBe('2');
    expect(firstCellOf('ZEBRA')).toBe('3');
  });

  test('Market Cap column is compact-formatted and sortable, positioned right after Name', () => {
    render(<StockUniverseTable data={universeData} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.replace(/[▲▼]/, ''));
    expect(headers.slice(0, 4)).toEqual(['Srl#', 'Symbol', 'Name', 'Market Cap']);
    expect(screen.getByText('$3T')).toBeInTheDocument(); // ZEBRA's 3e12
    expect(screen.getByText('$2.5B')).toBeInTheDocument(); // MID's 2.5e9
  });

  test('clicking Market Cap sorts ascending, nulls last', async () => {
    render(<StockUniverseTable data={universeData} />);
    await userEvent.click(screen.getByRole('button', { name: /Market Cap/ }));
    // MID ($2.5B) < ZEBRA ($3T), APPLE (null) sorts last regardless of direction.
    expect(rowOrder()).toEqual(['universe-row-MID', 'universe-row-ZEBRA', 'universe-row-APPLE']);
  });
});
