import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ColumnMappingWizard from './ColumnMappingWizard';

function renderWizard(onReady = vi.fn(), onCancel = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ColumnMappingWizard onReady={onReady} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { onReady, onCancel };
}

function csvFile(content: string, name = 'holdings.csv') {
  return new File([content], name, { type: 'text/csv' });
}

describe('ColumnMappingWizard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom doesn't implement scrollIntoView - the wizard's grid-selection highlight effect calls it.
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('Inspect Data stays disabled until every mandatory field is mapped, then previews and calls onReady', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios/flex' && options?.method === 'POST') {
        expect(JSON.parse(options.body as string).dryRun).toBe(true);
        return Promise.resolve({
          preview: true,
          holdings: [{ symbol: 'AAPL', name: '', quantity: 10, purchasePrice: 150, currentPrice: 150, sector: '', purchaseDate: '', costBasis: 1500, currentValue: 1500, gainLoss: 0, returnPct: 0 }],
          cashAmount: 0,
          errors: [],
        });
      }
      return Promise.resolve({});
    });
    const { onReady } = renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);

    const inspectButton = await screen.findByTestId('flex-inspect-data');
    expect(inspectButton).toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
    await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
    expect(inspectButton).toBeDisabled(); // currentPrice still unmapped

    await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
    expect(inspectButton).not.toBeDisabled();

    await userEvent.click(inspectButton);
    expect(await screen.findByText('4. Preview (first 5 records)')).toBeInTheDocument();
    expect(within(screen.getByTestId('flex-preview-table')).getByText('AAPL')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('flex-use-mapping'));
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
      columnMapping: { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' },
      filename: 'holdings.csv',
      headerRowIndex: 1,
      dataStartColumnIndex: 1,
    }));
  });

  function symbolOptionValues() {
    const select = screen.getByTestId('flex-map-symbol') as HTMLSelectElement;
    return Array.from(select.options).map((o) => o.value);
  }

  test('clicking a grid cell sets both header row/data start column and updates the derived mapping options', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    // Row 0: preamble text (not real headers). Row 1: the real header row, starting at column 1
    // (column 0 is a leading label column that should be skipped).
    const file = csvFile('Account Summary\nRow,Ticker,Shares,Price\nfoo,AAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await screen.findByTestId('flex-map-symbol');

    // Default (1, 1) selection - mapping dropdown offers the (wrong) row-0 preamble text.
    expect(symbolOptionValues()).toContain('Account Summary');

    // Click the cell at row 1 (0-based), column 1 (0-based) — "Ticker", the real first header cell.
    await userEvent.click(screen.getByTestId('grid-cell-1-1'));

    expect(screen.getByTestId('flex-header-row-input')).toHaveValue(2);
    expect(screen.getByTestId('flex-data-start-column-input')).toHaveValue(2);
    const optionsAfter = symbolOptionValues();
    expect(optionsAfter).toContain('Ticker');
    expect(optionsAfter).not.toContain('Row');
  });

  test('typing the header row/data start column numbers has the same effect as clicking the matching cell', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Account Summary\nRow,Ticker,Shares,Price\nfoo,AAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await screen.findByTestId('flex-map-symbol');

    const headerRowInput = screen.getByTestId('flex-header-row-input');
    await userEvent.clear(headerRowInput);
    await userEvent.type(headerRowInput, '2');
    const dataStartColumnInput = screen.getByTestId('flex-data-start-column-input');
    await userEvent.clear(dataStartColumnInput);
    await userEvent.type(dataStartColumnInput, '2');

    expect(symbolOptionValues()).toContain('Ticker');
  });

  test('changing the header row/data start column after a mapping was made clears that mapping', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
    expect(screen.getByTestId('flex-map-symbol')).toHaveValue('Ticker');

    await userEvent.click(screen.getByTestId('grid-cell-0-1'));

    expect(screen.getByTestId('flex-map-symbol')).toHaveValue('');
  });

  test('shows the backend error when Inspect Data rejects (e.g. an empty/unparseable file)', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(400, 'CSV appears to be empty or could not be parsed.', null));
    renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
    await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
    await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');

    await userEvent.click(screen.getByTestId('flex-inspect-data'));
    expect(await screen.findByText('CSV appears to be empty or could not be parsed.')).toBeInTheDocument();
  });
});
