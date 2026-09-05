import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import FlexResolutionBanner from './FlexResolutionBanner';
import type { MappingReadyResult } from './ColumnMappingWizard';

function renderBanner(sessionMapping: MappingReadyResult | null, onSaved = vi.fn(), onDeleted = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FlexResolutionBanner portfolioId="p1" portfolioName="My Flex Portfolio" sessionMapping={sessionMapping} onSaved={onSaved} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onSaved, onDeleted };
}

const mapping: MappingReadyResult = {
  columnMapping: { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' },
  filename: 'f.csv',
  content: 'Ticker,Shares,Price\nAAPL,10,150',
  preview: { preview: true, sourceFormat: 'csv', cashAmount: 0, errors: [], holdings: [{ symbol: 'AAPL', name: '', quantity: 10, purchasePrice: 150, currentPrice: 150, sector: '', purchaseDate: '', costBasis: 1500, currentValue: 1500, gainLoss: 0, returnPct: 0 }] },
  headerRowIndex: 1,
  dataStartColumnIndex: 1,
  footerMarkerColumnIndex: null,
  footerMarkerText: null,
  cashConfig: null,
};

describe('FlexResolutionBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('the template name field defaults to the portfolio\'s own name, not blank', async () => {
    renderBanner(mapping);
    expect(screen.getByTestId('flex-save-template-name')).toHaveValue('My Flex Portfolio');
  });

  test('with a session mapping available, Save Template only needs a name and calls onSaved', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios/p1/flex-template' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.templateName).toBe('Schwab Export');
        expect(body.columnMapping).toEqual(mapping.columnMapping);
        expect(body.headerRowIndex).toBe(1);
        expect(body.dataStartColumnIndex).toBe(1);
        expect(body.howToUseDescription).toBeUndefined(); // left blank - optional field, omitted rather than sent empty
        return Promise.resolve({ portfolio: { id: 'p1', flexTemplateStatus: 'Flex' }, template: { id: 't1', templateName: 'Schwab Export', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1', howToUseDescription: null } });
      }
      return Promise.resolve({});
    });
    const { onSaved } = renderBanner(mapping);

    expect(screen.queryByTestId('flex-mapping-file-input')).not.toBeInTheDocument();
    // The field is pre-filled with the portfolio's name - still editable to give the template
    // a different, more generic reusable name.
    await userEvent.clear(screen.getByTestId('flex-save-template-name'));
    await userEvent.type(screen.getByTestId('flex-save-template-name'), 'Schwab Export');
    await userEvent.click(screen.getByTestId('flex-save-template-submit'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('saving without editing the pre-filled name uses the portfolio\'s own name as the template name', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios/p1/flex-template' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.templateName).toBe('My Flex Portfolio');
        return Promise.resolve({ portfolio: { id: 'p1', flexTemplateStatus: 'Flex' }, template: { id: 't1', templateName: 'My Flex Portfolio', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1', howToUseDescription: null } });
      }
      return Promise.resolve({});
    });
    const { onSaved } = renderBanner(mapping);

    await userEvent.click(screen.getByTestId('flex-save-template-submit'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('a filled-in how-to-use description is sent along with Save Template', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios/p1/flex-template' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body.howToUseDescription).toBe('Headers on row 1');
        return Promise.resolve({ portfolio: { id: 'p1', flexTemplateStatus: 'Flex' }, template: { id: 't1', templateName: 'Schwab Export', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1', howToUseDescription: 'Headers on row 1' } });
      }
      return Promise.resolve({});
    });
    const { onSaved } = renderBanner(mapping);

    await userEvent.type(screen.getByTestId('flex-save-template-name'), 'Schwab Export');
    await userEvent.type(screen.getByTestId('flex-save-template-description'), 'Headers on row 1');
    await userEvent.click(screen.getByTestId('flex-save-template-submit'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('without a session mapping, the wizard must be re-run before Save Template appears', async () => {
    renderBanner(null);
    expect(screen.getByText(/original mapping isn't available/i)).toBeInTheDocument();
    expect(screen.getByTestId('flex-mapping-file-input')).toBeInTheDocument();
    expect(screen.queryByTestId('flex-save-template-name')).not.toBeInTheDocument();
  });

  test('Delete Portfolio requires confirmation before calling onDeleted', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ success: true });
    const { onDeleted } = renderBanner(mapping);

    await userEvent.click(screen.getByRole('button', { name: 'Delete Portfolio' }));
    expect(onDeleted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    expect(onDeleted).toHaveBeenCalled();
  });
});
