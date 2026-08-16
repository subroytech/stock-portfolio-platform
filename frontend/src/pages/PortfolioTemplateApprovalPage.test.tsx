import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import PortfolioTemplateApprovalPage from './PortfolioTemplateApprovalPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortfolioTemplateApprovalPage />
    </QueryClientProvider>,
  );
}

describe('PortfolioTemplateApprovalPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('lists every template regardless of status, with Approve/Reject only on Pending ones', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({
          templates: [
            { id: '1', templateName: 'Pending One', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' },
            { id: '2', templateName: 'Already Approved', status: 'Approved', createdBy: 'u2', createdAt: 't1' },
          ],
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await screen.findByText('Pending One');
    expect(screen.getByText('Already Approved')).toBeInTheDocument();

    const pendingRow = screen.getByTestId('template-row-1').closest('div')?.parentElement as HTMLElement;
    expect(within(pendingRow).getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    const approvedRow = screen.getByTestId('template-row-2').closest('div')?.parentElement as HTMLElement;
    expect(within(approvedRow).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  test('expanding a row fetches and shows its mapping + sample preview', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Schwab Export', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1') {
        return Promise.resolve({
          template: {
            id: '1', templateName: 'Schwab Export', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1',
            reviewedBy: null, reviewedAt: null, columnMapping: { symbol: 'Ticker', quantity: 'Shares' },
            samplePreview: [{ symbol: 'AAPL' }], headerRowIndex: 3, dataStartColumnIndex: 2,
            howToUseDescription: 'Schwab export — headers on row 3',
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-row-1'));
    expect(await screen.findByText('Column mapping')).toBeInTheDocument();
    expect(screen.getByText('Ticker')).toBeInTheDocument();
    expect(screen.getByText('Sample preview')).toBeInTheDocument();
    expect(screen.getByText('How to use')).toBeInTheDocument();
    expect(screen.getByText('Schwab export — headers on row 3')).toBeInTheDocument();
    expect(screen.getByText(/Header row 3, data starts at column 2/)).toBeInTheDocument();
  });

  test('Approve calls PUT /portfolio-templates/:id/status with Approved', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Pending One', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1/status' && options?.method === 'PUT') {
        expect(JSON.parse(options.body as string)).toEqual({ status: 'Approved' });
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(client.apiFetch).toHaveBeenCalledWith('/portfolio-templates/1/status', expect.objectContaining({ method: 'PUT' }));
  });

  test('Reject calls PUT /portfolio-templates/:id/status with Rejected', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Pending One', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1/status' && options?.method === 'PUT') {
        expect(JSON.parse(options.body as string)).toEqual({ status: 'Rejected' });
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(client.apiFetch).toHaveBeenCalledWith('/portfolio-templates/1/status', expect.objectContaining({ method: 'PUT' }));
  });
});
