import { render, screen, waitFor, within } from '@testing-library/react';
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
            footerMarkerColumnIndex: null, footerMarkerText: null,
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
    expect(screen.queryByText(/Footer detected/)).not.toBeInTheDocument(); // no footer marker configured
  });

  test('shows the footer marker line when a template has one configured', async () => {
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
            howToUseDescription: null, footerMarkerColumnIndex: 1, footerMarkerText: 'Total',
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-row-1'));
    expect(await screen.findByText(/Footer detected when column 1 contains "Total"/)).toBeInTheDocument();
  });

  test('shows the cash marker line (separate-column value source) when a template has one configured', async () => {
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
            howToUseDescription: null, footerMarkerColumnIndex: null, footerMarkerText: null,
            cashConfig: { markerColumnIndex: 1, markerText: 'Cash & Cash Investments', valueSource: { type: 'column', columnIndex: 3 } },
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-row-1'));
    expect(await screen.findByText(/Cash row detected when column 1 contains "Cash & Cash Investments" \(value from column 3\)/)).toBeInTheDocument();
  });

  test('shows the cash marker line (embedded value source) when a template has one configured', async () => {
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
            howToUseDescription: null, footerMarkerColumnIndex: null, footerMarkerText: null,
            cashConfig: { markerColumnIndex: 1, markerText: 'Cash, Money Funds', valueSource: { type: 'embedded' } },
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-row-1'));
    expect(await screen.findByText(/Cash row detected when column 1 contains "Cash, Money Funds" \(value embedded in the identifier cell\)/)).toBeInTheDocument();
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

  test('Delete is hidden for an Approved template', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Approved One', status: 'Approved', createdBy: 'u1', createdAt: 't1' }] });
      }
      return Promise.resolve({});
    });
    renderPage();

    await screen.findByText('Approved One');
    expect(screen.queryByTestId('template-delete-1')).not.toBeInTheDocument();
  });

  test('Delete requires confirmation, then calls DELETE /portfolio-templates/:id, for a Pending/Rejected template', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Orphaned One', status: 'Rejected', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1' && options?.method === 'DELETE') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-delete-1'));
    expect(client.apiFetch).not.toHaveBeenCalledWith('/portfolio-templates/1', expect.objectContaining({ method: 'DELETE' }));

    await userEvent.click(screen.getByTestId('template-delete-confirm-1'));
    expect(client.apiFetch).toHaveBeenCalledWith('/portfolio-templates/1', expect.objectContaining({ method: 'DELETE' }));
  });

  test('a 409 in-use error from Delete opens the Bound Portfolios pop-up', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Bound One', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1' && options?.method === 'DELETE') {
        return Promise.reject(new client.ApiError(409, 'Cannot delete a template that is still bound to an existing portfolio.', null));
      }
      if (url === '/portfolio-templates/1/bound-portfolios') {
        return Promise.resolve({ portfolios: [{ id: 'p1', name: 'Charles-Schwab', ownerEmail: 'owner@b.com', createdAt: 't1' }] });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-delete-1'));
    await userEvent.click(screen.getByTestId('template-delete-confirm-1'));

    expect(await screen.findByText('Charles-Schwab')).toBeInTheDocument();
    expect(screen.getByText('owner@b.com')).toBeInTheDocument();
    // Not the old plain-error rendering - the pop-up replaces it with an actionable list.
    expect(screen.queryByText('Cannot delete a template that is still bound to an existing portfolio.')).not.toBeInTheDocument();
  });

  test('deleting the last bound portfolio reveals Delete Template, which then completes the delete', async () => {
    let portfolioDeleted = false;
    let templateDeleteAttempts = 0;
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolio-templates/admin/all') {
        return Promise.resolve({ templates: [{ id: '1', templateName: 'Bound One', status: 'Pending Approval', createdBy: 'u1', createdAt: 't1' }] });
      }
      if (url === '/portfolio-templates/1' && options?.method === 'DELETE') {
        templateDeleteAttempts += 1;
        // First attempt (portfolio still bound) 409s and opens the pop-up; the second attempt
        // (from the pop-up's own "Delete Template" button, once the list is empty) succeeds.
        if (templateDeleteAttempts === 1) {
          return Promise.reject(new client.ApiError(409, 'Cannot delete a template that is still bound to an existing portfolio.', null));
        }
        return Promise.resolve({ success: true });
      }
      if (url === '/portfolio-templates/1/bound-portfolios/p1' && options?.method === 'DELETE') {
        portfolioDeleted = true;
        return Promise.resolve({ success: true });
      }
      if (url === '/portfolio-templates/1/bound-portfolios') {
        return Promise.resolve({ portfolios: portfolioDeleted ? [] : [{ id: 'p1', name: 'Charles-Schwab', ownerEmail: 'owner@b.com', createdAt: 't1' }] });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('template-delete-1'));
    await userEvent.click(screen.getByTestId('template-delete-confirm-1'));

    await screen.findByText('Charles-Schwab');
    await userEvent.click(screen.getByTestId('bound-portfolio-delete-p1'));
    await userEvent.click(screen.getByTestId('bound-portfolio-delete-confirm-p1'));

    expect(await screen.findByText('All bound portfolios removed.')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('bound-portfolios-delete-template'));

    await waitFor(() => expect(screen.queryByTestId('bound-portfolios-delete-template')).not.toBeInTheDocument());
    expect(templateDeleteAttempts).toBe(2);
  });

  describe('Unattached Flex Portfolios', () => {
    test('shows the empty state when none exist', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/portfolio-templates/admin/all') return Promise.resolve({ templates: [] });
        if (url === '/portfolio-templates/unattached-portfolios') return Promise.resolve({ portfolios: [] });
        return Promise.resolve({});
      });
      renderPage();

      expect(await screen.findByText('No unattached Flex portfolios.')).toBeInTheDocument();
    });

    test('lists each one with owner, holdings count, and cash amount', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/portfolio-templates/admin/all') return Promise.resolve({ templates: [] });
        if (url === '/portfolio-templates/unattached-portfolios') {
          return Promise.resolve({
            portfolios: [{ id: 'p1', name: 'Abandoned Mapping', ownerEmail: 'owner@b.com', createdAt: 't1', holdingsCount: 3, cashAmount: 125.5 }],
          });
        }
        return Promise.resolve({});
      });
      renderPage();

      expect(await screen.findByText('Abandoned Mapping')).toBeInTheDocument();
      expect(screen.getByText(/owner@b\.com.*3 holdings.*\$125\.50 cash/)).toBeInTheDocument();
    });

    test('Delete requires confirmation, then calls DELETE /portfolio-templates/unattached-portfolios/:id', async () => {
      let deleted = false;
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/portfolio-templates/admin/all') return Promise.resolve({ templates: [] });
        if (url === '/portfolio-templates/unattached-portfolios') {
          return Promise.resolve({
            portfolios: deleted ? [] : [{ id: 'p1', name: 'Abandoned Mapping', ownerEmail: 'owner@b.com', createdAt: 't1', holdingsCount: 1, cashAmount: 0 }],
          });
        }
        if (url === '/portfolio-templates/unattached-portfolios/p1' && options?.method === 'DELETE') {
          deleted = true;
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });
      renderPage();

      await userEvent.click(await screen.findByTestId('unattached-portfolio-delete-p1'));
      expect(client.apiFetch).not.toHaveBeenCalledWith('/portfolio-templates/unattached-portfolios/p1', expect.objectContaining({ method: 'DELETE' }));

      await userEvent.click(screen.getByTestId('unattached-portfolio-delete-confirm-p1'));
      expect(client.apiFetch).toHaveBeenCalledWith('/portfolio-templates/unattached-portfolios/p1', expect.objectContaining({ method: 'DELETE' }));
      await waitFor(() => expect(screen.getByText('No unattached Flex portfolios.')).toBeInTheDocument());
    });
  });
});
