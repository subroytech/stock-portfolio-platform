import { act, render, screen, within } from '@testing-library/react';
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

// The staged Header -> Footer -> Cash -> Map Columns flow (CLAUDE.md's "Portfolio Upload -
// Flex" section) means every test that needs the mapping section has to actively advance
// through the earlier stages first - these helpers do that without each test having to spell
// out the navigation.
async function confirmHeaderDefault() {
  await userEvent.click(screen.getByTestId('grid-cell-0-0')); // row 1, column 1 - same as the defaults, but confirms
}
async function goNextFromHeader() {
  await userEvent.click(screen.getByTestId('wizard-next-header'));
}
async function goNextFromFooter() {
  await userEvent.click(screen.getByTestId('wizard-next-footer'));
}
async function goNextFromCash() {
  await userEvent.click(screen.getByTestId('wizard-next-cash'));
}
async function reachMappingStage() {
  await confirmHeaderDefault();
  await goNextFromHeader();
  await goNextFromFooter();
  await goNextFromCash();
}

// jsdom doesn't implement IntersectionObserver - the "scroll to review" gate on Use This
// Mapping needs one. Captures every observer's callback so a test can simulate its sentinel
// scrolling into view on demand, without a real scroll.
let intersectionCallbacks: IntersectionObserverCallback[] = [];
function simulatePreviewScrolledIntoView() {
  act(() => {
    intersectionCallbacks.forEach((cb) => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  });
}

describe('ColumnMappingWizard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom doesn't implement scrollIntoView - the wizard's grid-selection highlight effect calls it.
    Element.prototype.scrollIntoView = vi.fn();
    intersectionCallbacks = [];
    // vi.fn() around an arrow function can't be used with `new` - a regular function expression
    // is required for the mock to work as a constructor.
    vi.stubGlobal('IntersectionObserver', vi.fn(function (this: unknown, cb: IntersectionObserverCallback) {
      intersectionCallbacks.push(cb);
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), takeRecords: vi.fn(() => []), root: null, rootMargin: '', thresholds: [] };
    }));
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
    await reachMappingStage();

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

    simulatePreviewScrolledIntoView();
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
    await screen.findByTestId('flex-header-row-input');

    // Click the cell at row 1 (0-based), column 1 (0-based) — "Ticker", the real first header cell.
    await userEvent.click(screen.getByTestId('grid-cell-1-1'));

    expect(screen.getByTestId('flex-header-row-input')).toHaveValue(2);
    expect(screen.getByTestId('flex-data-start-column-input')).toHaveValue(2);

    // Advance to the mapping stage to see the derived options.
    await goNextFromHeader();
    await goNextFromFooter();
    await goNextFromCash();
    const optionsAfter = symbolOptionValues();
    expect(optionsAfter).toContain('Ticker');
    expect(optionsAfter).not.toContain('Row');
  });

  test('no row is highlighted as the header row until the user actually confirms one (by click or by typing)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await screen.findByTestId('flex-header-row-input');

    // headerRowIndex defaults to 1, but nothing has been confirmed yet - row 0 must not look
    // specially selected just because a file loaded.
    expect(screen.getByTestId('grid-cell-0-0').closest('tr')).not.toHaveClass('bg-green-300');

    await userEvent.click(screen.getByTestId('grid-cell-0-0'));
    expect(screen.getByTestId('grid-cell-0-0').closest('tr')).toHaveClass('bg-green-300');
  });

  test('each grid row shows a non-clickable row number as its first column', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Account Summary\nRow,Ticker,Shares,Price\nfoo,AAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await screen.findByTestId('flex-header-row-input');

    const row0 = screen.getByTestId('grid-cell-0-0').closest('tr')!;
    const row2 = screen.getByTestId('grid-cell-2-0').closest('tr')!;
    expect(within(row0).getByText('1')).toBeInTheDocument();
    expect(within(row2).getByText('3')).toBeInTheDocument();
    // The row-number cell itself has no click handler - only the real data cells do.
    expect(within(row0).getByText('1').tagName).toBe('TD');
  });

  test('typing the header row/data start column numbers has the same effect as clicking the matching cell', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Account Summary\nRow,Ticker,Shares,Price\nfoo,AAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await screen.findByTestId('flex-header-row-input');

    const headerRowInput = screen.getByTestId('flex-header-row-input');
    await userEvent.clear(headerRowInput);
    await userEvent.type(headerRowInput, '2');
    const dataStartColumnInput = screen.getByTestId('flex-data-start-column-input');
    await userEvent.clear(dataStartColumnInput);
    await userEvent.type(dataStartColumnInput, '2');

    await goNextFromHeader();
    await goNextFromFooter();
    await goNextFromCash();
    expect(symbolOptionValues()).toContain('Ticker');
  });

  test('changing the header row/data start column after a mapping was made clears that mapping', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({});
    renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await reachMappingStage();

    await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
    expect(screen.getByTestId('flex-map-symbol')).toHaveValue('Ticker');

    // Back into the header stage, then click a different cell.
    await userEvent.click(screen.getByTestId('wizard-edit-markers'));
    await userEvent.click(screen.getByTestId('wizard-back-cash'));
    await userEvent.click(screen.getByTestId('wizard-back-footer'));
    await userEvent.click(screen.getByTestId('grid-cell-0-1'));

    await goNextFromHeader();
    await goNextFromFooter();
    await goNextFromCash();
    expect(screen.getByTestId('flex-map-symbol')).toHaveValue('');
  });

  test('shows the backend error when Inspect Data rejects (e.g. an empty/unparseable file)', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(400, 'CSV appears to be empty or could not be parsed.', null));
    renderWizard();

    const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
    await reachMappingStage();

    await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
    await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
    await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');

    await userEvent.click(screen.getByTestId('flex-inspect-data'));
    expect(await screen.findByText('CSV appears to be empty or could not be parsed.')).toBeInTheDocument();
  });

  test('rejects a sample file over the 202-row hard limit and never shows the mapping step', async () => {
    renderWizard();

    const oversized = new Array(203).fill('a,b,c').join('\n');
    const file = csvFile(oversized);
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);

    expect(await screen.findByText(/at most 202 rows/)).toBeInTheDocument();
    expect(screen.queryByTestId('flex-header-row-input')).not.toBeInTheDocument();
  });

  test('accepts a sample file at exactly the 202-row limit', async () => {
    renderWizard();

    const atLimit = new Array(202).fill('a,b,c').join('\n');
    const file = csvFile(atLimit);
    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);

    expect(await screen.findByTestId('flex-header-row-input')).toBeInTheDocument();
    expect(screen.queryByText(/at most 202 rows/)).not.toBeInTheDocument();
  });

  describe('the guided Header -> Footer -> Cash -> Map Columns stepper', () => {
    test('the single-line progress indicator reflects done/current/upcoming as the stages advance', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await screen.findByTestId('wizard-stepper');

      expect(screen.getByTestId('wizard-step-header')).toHaveAttribute('data-state', 'current');
      expect(screen.getByTestId('wizard-step-footer')).toHaveAttribute('data-state', 'upcoming');
      expect(screen.getByTestId('wizard-step-cash')).toHaveAttribute('data-state', 'upcoming');
      expect(screen.getByTestId('wizard-step-mapping')).toHaveAttribute('data-state', 'upcoming');

      await confirmHeaderDefault();
      await goNextFromHeader();
      expect(screen.getByTestId('wizard-step-header')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('wizard-step-footer')).toHaveAttribute('data-state', 'current');

      await goNextFromFooter();
      expect(screen.getByTestId('wizard-step-footer')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('wizard-step-cash')).toHaveAttribute('data-state', 'current');

      await goNextFromCash();
      expect(screen.getByTestId('wizard-step-cash')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('wizard-step-mapping')).toHaveAttribute('data-state', 'current');
      expect(screen.getByTestId('wizard-step-inspectData')).toHaveAttribute('data-state', 'upcoming');
      expect(screen.getByTestId('wizard-step-confirmMapping')).toHaveAttribute('data-state', 'upcoming');
    });

    test('mapColumns/inspectData/confirmMapping progress as the mapping stage itself advances', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await reachMappingStage();

      expect(screen.getByTestId('wizard-step-mapping')).toHaveAttribute('data-state', 'current');
      expect(screen.getByTestId('wizard-step-inspectData')).toHaveAttribute('data-state', 'upcoming');

      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      expect(screen.getByTestId('wizard-step-mapping')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('wizard-step-inspectData')).toHaveAttribute('data-state', 'current');
      expect(screen.getByTestId('wizard-step-confirmMapping')).toHaveAttribute('data-state', 'upcoming');

      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      expect(screen.getByTestId('wizard-step-inspectData')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('wizard-step-confirmMapping')).toHaveAttribute('data-state', 'current');
    });

    test('"3. Map columns" is hidden until the cash stage resolves', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await screen.findByTestId('flex-header-row-input');
      expect(screen.queryByText('3. Map columns')).not.toBeInTheDocument();

      await confirmHeaderDefault();
      await goNextFromHeader();
      expect(screen.queryByText('3. Map columns')).not.toBeInTheDocument(); // footer stage now

      await goNextFromFooter();
      expect(screen.queryByText('3. Map columns')).not.toBeInTheDocument(); // cash stage now

      await goNextFromCash();
      expect(screen.getByText('3. Map columns')).toBeInTheDocument();
    });

    test('the Next button on the header stage is absent until the header row is actually confirmed', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await screen.findByTestId('flex-header-row-input');

      expect(screen.queryByTestId('wizard-next-header')).not.toBeInTheDocument();
      expect(screen.getByText('Confirm the header row to continue')).toBeInTheDocument();
      await confirmHeaderDefault();
      expect(screen.getByTestId('wizard-next-header')).toBeInTheDocument();
      expect(screen.queryByText('Confirm the header row to continue')).not.toBeInTheDocument();
    });

    test('Skip on the footer stage advances to the cash stage without setting a footer marker', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.footerMarkerColumnIndex).toBeUndefined();
          expect(body.footerMarkerText).toBeUndefined();
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      expect(screen.getByTestId('wizard-next-footer')).toHaveTextContent('Skip footer marker →');
      await goNextFromFooter();
      await goNextFromCash();

      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ footerMarkerColumnIndex: null, footerMarkerText: null }));
    });

    test('Back returns to the previous stage without clearing data already entered there', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nTotal,,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      const columnInput = screen.getByTestId('flex-footer-marker-column-input');
      await userEvent.clear(columnInput);
      await userEvent.type(columnInput, '1');
      await userEvent.type(screen.getByTestId('flex-footer-marker-text'), 'Total');

      await goNextFromFooter(); // -> cash stage
      await userEvent.click(screen.getByTestId('wizard-back-cash')); // -> back to footer

      expect(screen.getByTestId('flex-footer-marker-column-input')).toHaveValue(1);
      expect(screen.getByTestId('flex-footer-marker-text')).toHaveValue('Total');
    });
  });

  describe('footer marker (footer stage)', () => {
    test('"Set footer marker" — clicking a cell sets the column and pre-fills the marker text, included in onReady\'s payload', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.footerMarkerColumnIndex).toBe(1);
          expect(body.footerMarkerText).toBe('Total');
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

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nTotal,,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      await userEvent.click(screen.getByTestId('grid-cell-2-0')); // the "Total" cell, row 2 (0-based), column 0
      expect(screen.getByTestId('flex-footer-marker-text')).toHaveValue('Total');

      await goNextFromFooter();
      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ footerMarkerColumnIndex: 1, footerMarkerText: 'Total' }));
    });

    test('typing a footer marker column + text directly (no cell click) sets both and is included in onReady\'s payload', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.footerMarkerColumnIndex).toBe(1);
          expect(body.footerMarkerText).toBe('Total');
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

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nTotal,,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      // No grid click at all - just type into the two footer marker inputs directly.
      const columnInput = screen.getByTestId('flex-footer-marker-column-input');
      await userEvent.clear(columnInput);
      await userEvent.type(columnInput, '1');
      await userEvent.type(screen.getByTestId('flex-footer-marker-text'), 'Total');

      await goNextFromFooter();
      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ footerMarkerColumnIndex: 1, footerMarkerText: 'Total' }));
    });

    test('typing text alone, with no column set, does not apply a footer marker', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.footerMarkerColumnIndex).toBeUndefined();
          expect(body.footerMarkerText).toBeUndefined();
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nTotal,,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      await userEvent.type(screen.getByTestId('flex-footer-marker-text'), 'Total');

      await goNextFromFooter();
      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ footerMarkerColumnIndex: null, footerMarkerText: null }));
    });

    test('the row currently matched by the footer marker is highlighted, and stops being highlighted once no row matches', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nTotal,,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await confirmHeaderDefault();
      await goNextFromHeader();

      const columnInput = screen.getByTestId('flex-footer-marker-column-input');
      await userEvent.clear(columnInput);
      await userEvent.type(columnInput, '1');
      await userEvent.type(screen.getByTestId('flex-footer-marker-text'), 'Total');

      const matchRow = await screen.findByTestId('flex-footer-match-row');
      expect(matchRow).toHaveTextContent('Total');

      // Narrow the text to something that matches nothing - the highlight should disappear.
      const textInput = screen.getByTestId('flex-footer-marker-text');
      await userEvent.clear(textInput);
      await userEvent.type(textInput, 'Nonexistent');
      expect(screen.queryByTestId('flex-footer-match-row')).not.toBeInTheDocument();
    });

    test('footer marker fields default to null when never set', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.footerMarkerColumnIndex).toBeUndefined();
          expect(body.footerMarkerText).toBeUndefined();
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await reachMappingStage();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ footerMarkerColumnIndex: null, footerMarkerText: null }));
    });
  });

  describe('cash marker (cash stage)', () => {
    async function goToCashStage() {
      await confirmHeaderDefault();
      await goNextFromHeader();
      await goNextFromFooter();
    }

    test('"Set cash marker" — clicking a cell sets the column and pre-fills the marker text, included in onReady\'s payload', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.cashConfig).toEqual({ markerColumnIndex: 1, markerText: 'Cash & Cash Investments' });
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

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash & Cash Investments,,1000');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0')); // the "Cash & Cash Investments" cell
      expect(screen.getByTestId('flex-cash-marker-text')).toHaveValue('Cash & Cash Investments');

      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
        cashConfig: { markerColumnIndex: 1, markerText: 'Cash & Cash Investments' },
      }));
    });

    test('"Separate column" mode: clicking "Set cash value column" then a cell sets the column, included in onReady\'s payload', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.cashConfig).toEqual({
            markerColumnIndex: 1, markerText: 'Cash & Cash Investments', valueSource: { type: 'column', columnIndex: 3 },
          });
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 1000, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash & Cash Investments,,1000');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0')); // sets the marker
      await userEvent.click(screen.getByTestId('cash-value-mode-column'));
      await userEvent.click(screen.getByTestId('cash-pick-value'));
      await userEvent.click(screen.getByTestId('grid-cell-2-2')); // the "1000" cell, column 2 (0-based)

      expect(screen.getByTestId('flex-cash-value-column-input')).toHaveValue(3);

      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
        cashConfig: { markerColumnIndex: 1, markerText: 'Cash & Cash Investments', valueSource: { type: 'column', columnIndex: 3 } },
      }));
    });

    test('manually typing the cash value column (no cell click) still sets it', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash & Cash Investments,,1000');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0'));
      await userEvent.click(screen.getByTestId('cash-value-mode-column'));

      const valueColumnInput = screen.getByTestId('flex-cash-value-column-input');
      await userEvent.clear(valueColumnInput);
      await userEvent.type(valueColumnInput, '3');

      expect(screen.getByTestId('flex-cash-value-column-input')).toHaveValue(3);
    });

    // Regression test for a real bug caught live: switching to "Separate column" mode left the
    // grid's click target defaulted to "marker", so clicking the value cell right afterward
    // (the natural next action, without an extra explicit "Set cash value column" click)
    // silently overwrote the already-correct marker instead of setting the value column.
    test('clicking a cell immediately after switching to "Separate column" mode sets the value column, not the marker', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash & Cash Investments,,1000');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0')); // sets the marker to "Cash & Cash Investments"
      await userEvent.click(screen.getByTestId('cash-value-mode-column')); // no explicit "Set cash value column" click
      await userEvent.click(screen.getByTestId('grid-cell-2-2')); // the "1000" cell

      expect(screen.getByTestId('flex-cash-marker-text')).toHaveValue('Cash & Cash Investments'); // untouched
      expect(screen.getByTestId('flex-cash-value-column-input')).toHaveValue(3); // set, not the marker
    });

    test('"Embedded in this cell" mode hides the value-column input entirely', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.cashConfig).toEqual({
            markerColumnIndex: 1, markerText: 'Cash, Money Funds: $2,143.67', valueSource: { type: 'embedded' },
          });
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 2143.67, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\n"Cash, Money Funds: $2,143.67",,');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0'));
      expect(screen.getByTestId('cash-value-mode-column')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('cash-value-mode-embedded'));
      expect(screen.queryByTestId('flex-cash-value-column-input')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cash-pick-value')).not.toBeInTheDocument();

      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
        cashConfig: { markerColumnIndex: 1, markerText: 'Cash, Money Funds: $2,143.67', valueSource: { type: 'embedded' } },
      }));
    });

    test('every row matched by the cash marker is highlighted, not just the first', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({});
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash Reserve A,,500\nCash Reserve B,,700');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      const columnInput = screen.getByTestId('flex-cash-marker-column-input');
      await userEvent.clear(columnInput);
      await userEvent.type(columnInput, '1');
      await userEvent.type(screen.getByTestId('flex-cash-marker-text'), 'Cash Reserve');

      const matchRows = await screen.findAllByTestId('flex-cash-match-row');
      expect(matchRows).toHaveLength(2);
      expect(matchRows[0]).toHaveTextContent('Cash Reserve A');
      expect(matchRows[1]).toHaveTextContent('Cash Reserve B');

      // Narrow the text to something that matches nothing - the highlight should disappear.
      const textInput = screen.getByTestId('flex-cash-marker-text');
      await userEvent.clear(textInput);
      await userEvent.type(textInput, 'Nonexistent');
      expect(screen.queryByTestId('flex-cash-match-row')).not.toBeInTheDocument();
    });

    test('cash config defaults to null when never set', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          expect(body.cashConfig).toBeUndefined();
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      const { onReady } = renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await reachMappingStage();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
      simulatePreviewScrolledIntoView();
      await userEvent.click(screen.getByTestId('flex-use-mapping'));

      expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ cashConfig: null }));
    });

    test('the preview step shows the cash amount detected by Inspect Data', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 500, errors: [] });
        }
        return Promise.resolve({});
      });
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150\nCash & Cash Investments,,500');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await goToCashStage();

      await userEvent.click(screen.getByTestId('grid-cell-2-0'));
      await userEvent.click(screen.getByTestId('cash-value-mode-column'));
      await userEvent.click(screen.getByTestId('grid-cell-2-2'));

      await goNextFromCash();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');

      expect(screen.getByTestId('flex-preview-cash-amount')).toHaveTextContent('Cash detected: $500.00');
    });
  });

  describe('"scroll to review" gate on Use This Mapping', () => {
    async function reachPreview() {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolios/flex' && options?.method === 'POST') {
          return Promise.resolve({ preview: true, holdings: [], cashAmount: 0, errors: [] });
        }
        return Promise.resolve({});
      });
      renderWizard();

      const file = csvFile('Ticker,Shares,Price\nAAPL,10,150');
      await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), file);
      await reachMappingStage();
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
      await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');
    }

    test('Use This Mapping is disabled, with a remark, until the preview has actually scrolled into view', async () => {
      await reachPreview();

      expect(screen.getByTestId('flex-use-mapping')).toBeDisabled();
      expect(screen.getByTestId('flex-scroll-remark')).toHaveTextContent('Scroll down to review the preview data before continuing');

      simulatePreviewScrolledIntoView();
      expect(screen.getByTestId('flex-use-mapping')).not.toBeDisabled();
      expect(screen.queryByTestId('flex-scroll-remark')).not.toBeInTheDocument();
    });

    test('re-running Inspect Data resets the gate, requiring the preview to be scrolled into view again', async () => {
      await reachPreview();
      simulatePreviewScrolledIntoView();
      expect(screen.getByTestId('flex-use-mapping')).not.toBeDisabled();

      // Change a mapping and re-inspect - a genuinely new preview should need its own fresh scroll.
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), '');
      await userEvent.selectOptions(screen.getByTestId('flex-map-symbol'), 'Ticker');
      await userEvent.click(screen.getByTestId('flex-inspect-data'));
      await screen.findByText('4. Preview (first 5 records)');

      expect(screen.getByTestId('flex-use-mapping')).toBeDisabled();
      expect(screen.getByTestId('flex-scroll-remark')).toBeInTheDocument();
    });
  });
});
