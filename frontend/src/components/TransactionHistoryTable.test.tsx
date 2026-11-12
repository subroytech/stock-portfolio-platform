import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import TransactionHistoryTable from './TransactionHistoryTable';

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TransactionHistoryTable portfolioId="p1" />
    </QueryClientProvider>,
  );
}

const TRANSACTIONS = [
  { id: '1', symbol: 'MSFT', name: 'Microsoft Corporation', actionType: 'SELL' as const, quantityDelta: 2, price: 200, actionDateTime: '2026-07-01T00:00:00Z' },
  { id: '2', symbol: 'AAPL', name: 'Apple Inc.', actionType: 'BUY' as const, quantityDelta: 10, price: 100, actionDateTime: '2026-07-10T00:00:00Z' },
  { id: '3', symbol: 'AAPL', name: 'Apple Inc.', actionType: 'SELL' as const, quantityDelta: 3, price: 120, actionDateTime: '2026-08-01T00:00:00Z' },
];

function rowSymbols() {
  return screen.getAllByTestId(/^transaction-row-/).map((row) => within(row).getAllByRole('cell')[0].textContent);
}

describe('TransactionHistoryTable', () => {
  test('shows an empty state when there is no transaction history yet', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: [] });
    renderTable();
    expect(await screen.findByText(/No buy\/sell activity recorded yet/)).toBeInTheDocument();
  });

  test('shows an error message when the fetch fails', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new Error('network error'));
    renderTable();
    expect(await screen.findByText(/Couldn.t load transaction history/)).toBeInTheDocument();
  });

  test('fetches from the right endpoint and renders every row', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/portfolios/p1/transactions'));
    expect(await screen.findByTestId('transaction-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-row-3')).toBeInTheDocument();
  });

  test('defaults to Ticker ascending, then Date descending within each ticker', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    await screen.findByTestId('transaction-row-1');
    // AAPL's two rows (ids 2 and 3) come before MSFT's (id 1); within AAPL, the later date (id 3,
    // Aug 1) comes before the earlier one (id 2, Jul 10) - descending by date.
    expect(rowSymbols()).toEqual(['AAPL', 'AAPL', 'MSFT']);
    const rows = screen.getAllByTestId(/^transaction-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'transaction-row-3');
    expect(rows[1]).toHaveAttribute('data-testid', 'transaction-row-2');
  });

  test('computes the Value column as quantity times price, positive for BUY', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: [TRANSACTIONS[1]] }); // AAPL BUY, 10 @ $100
    renderTable();
    const row = await screen.findByTestId('transaction-row-2');
    expect(within(row).getByText('$1,000.00')).toBeInTheDocument();
  });

  test('Value is negative for SELL', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: [TRANSACTIONS[0]] }); // MSFT SELL, 2 @ $200
    renderTable();
    const row = await screen.findByTestId('transaction-row-1');
    expect(within(row).getByText('-$400.00')).toBeInTheDocument();
  });

  test('renders the ticker Name column', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    const row = await screen.findByTestId('transaction-row-2');
    expect(within(row).getByText('Apple Inc.')).toBeInTheDocument();
  });

  // A long name is visually clipped (CSS truncate, not a DOM-level cut) so it can't blow out
  // the table's own deliberately narrower max-width - the full name is still in the DOM and
  // shown via the title tooltip on hover.
  test('a long Name is visually truncated but still fully present, via a title tooltip', async () => {
    const longName = 'ARCHER AVIATION INC COM CL A - A Very Long Company Name';
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: [{ ...TRANSACTIONS[0], name: longName }] });
    renderTable();
    const row = await screen.findByTestId('transaction-row-1');
    const nameCell = within(row).getByText(longName);
    expect(nameCell).toHaveClass('truncate');
    expect(nameCell).toHaveAttribute('title', longName);
  });

  test('shows an em dash for Name when the ticker has never been enriched in m_tickers', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: [{ ...TRANSACTIONS[0], name: null }] });
    renderTable();
    const row = await screen.findByTestId('transaction-row-1');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('BUY and SELL render with distinct styling', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    const buyRow = await screen.findByTestId('transaction-row-2');
    const sellRow = screen.getByTestId('transaction-row-1');
    expect(within(buyRow).getByText('BUY')).toHaveClass('text-success');
    expect(within(sellRow).getByText('SELL')).toHaveClass('text-danger');
  });

  test('switching the primary sort field re-sorts the table', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    await screen.findByTestId('transaction-row-1');

    await userEvent.selectOptions(screen.getByTestId('transaction-sort-primary-field'), 'price');
    // Ascending by price: MSFT@200(id1)? no - price values are 200, 100, 120 -> ascending: 100(id2), 120(id3), 200(id1)
    await waitFor(() => {
      const rows = screen.getAllByTestId(/^transaction-row-/);
      expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
        'transaction-row-2', 'transaction-row-3', 'transaction-row-1',
      ]);
    });
  });

  test('toggling the primary sort direction reverses the order', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    await screen.findByTestId('transaction-row-1');
    expect(rowSymbols()).toEqual(['AAPL', 'AAPL', 'MSFT']);

    await userEvent.click(screen.getByTestId('transaction-sort-primary-direction'));
    await waitFor(() => expect(rowSymbols()).toEqual(['MSFT', 'AAPL', 'AAPL']));
  });

  test('changing the secondary field/direction changes the tiebreak order within a tied primary group', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ transactions: TRANSACTIONS });
    renderTable();
    await screen.findByTestId('transaction-row-1');
    // Default secondary is Date desc - AAPL group is [3 (Aug 1), 2 (Jul 10)].
    let rows = screen.getAllByTestId(/^transaction-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'transaction-row-3');
    expect(rows[1]).toHaveAttribute('data-testid', 'transaction-row-2');

    await userEvent.click(screen.getByTestId('transaction-sort-secondary-direction'));
    await waitFor(() => {
      rows = screen.getAllByTestId(/^transaction-row-/);
      expect(rows[0]).toHaveAttribute('data-testid', 'transaction-row-2');
      expect(rows[1]).toHaveAttribute('data-testid', 'transaction-row-3');
    });
  });
});
