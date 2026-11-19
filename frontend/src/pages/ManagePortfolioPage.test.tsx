import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ManagePortfolioPage from './ManagePortfolioPage';

const PORTFOLIOS = [
  { id: 'p1', name: 'Fidelity', ownerUserId: 'u1', ownerEmail: 'a@example.com', portfolioType: 'Legacy', status: 'Active', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
  { id: 'p2', name: 'Schwab', ownerUserId: 'u1', ownerEmail: 'a@example.com', portfolioType: 'Flex', status: 'Soft-Delete', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
  { id: 'p3', name: 'Empower', ownerUserId: 'u2', ownerEmail: 'b@example.com', portfolioType: 'Legacy', status: 'In-Active', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
] as const;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManagePortfolioPage />
    </QueryClientProvider>,
  );
}

function rowIds() {
  return screen.getAllByTestId(/^managed-portfolio-row-/).map((r) => r.getAttribute('data-testid'));
}

describe('ManagePortfolioPage', () => {
  test('lists every portfolio across all statuses, in the server\'s order', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ portfolios: PORTFOLIOS });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p1');
    expect(rowIds()).toEqual(['managed-portfolio-row-p1', 'managed-portfolio-row-p2', 'managed-portfolio-row-p3']);
  });

  test('Restore and Delete icons appear only on Soft-Delete rows', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ portfolios: PORTFOLIOS });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p1');
    expect(screen.getByTestId('restore-portfolio-p2')).toBeInTheDocument();
    expect(screen.getByTestId('permanent-delete-portfolio-p2')).toBeInTheDocument();
    expect(screen.queryByTestId('restore-portfolio-p1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permanent-delete-portfolio-p1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restore-portfolio-p3')).not.toBeInTheDocument();
  });

  test('single-select filters narrow the list (User, Portfolio Type, Status)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ portfolios: PORTFOLIOS });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p1');

    await userEvent.selectOptions(screen.getByTestId('manage-portfolio-filter-user'), 'u2');
    expect(rowIds()).toEqual(['managed-portfolio-row-p3']);

    await userEvent.selectOptions(screen.getByTestId('manage-portfolio-filter-user'), '');
    await userEvent.selectOptions(screen.getByTestId('manage-portfolio-filter-type'), 'Flex');
    expect(rowIds()).toEqual(['managed-portfolio-row-p2']);

    await userEvent.selectOptions(screen.getByTestId('manage-portfolio-filter-type'), '');
    await userEvent.selectOptions(screen.getByTestId('manage-portfolio-filter-status'), 'Active');
    expect(rowIds()).toEqual(['managed-portfolio-row-p1']);
  });

  test('Delete shows the permanent-deletion warning before anything is removed', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ portfolios: PORTFOLIOS });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p2');

    await userEvent.click(screen.getByTestId('permanent-delete-portfolio-p2'));
    const warning = screen.getByTestId('permanent-delete-warning');
    expect(warning).toHaveTextContent("All records pertaining to this portfolio will be permanently deleted and can't be recovered.");
    expect(spy.mock.calls.some(([, opts]) => (opts as RequestInit | undefined)?.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('permanent-delete-warning')).not.toBeInTheDocument();
  });

  test('confirming Delete sends the permanent delete for that portfolio', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ portfolios: PORTFOLIOS });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p2');

    await userEvent.click(screen.getByTestId('permanent-delete-portfolio-p2'));
    await userEvent.click(screen.getByTestId('permanent-delete-confirm'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('/portfolio-admin/portfolios/p2', { method: 'DELETE' });
    });
  });

  test('Restore posts to the restore endpoint and shows the server\'s message on a conflict', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url.endsWith('/restore')) {
        return Promise.reject(new client.ApiError(409, 'Can\'t restore: this user already has an active portfolio named "Schwab".', null));
      }
      return Promise.resolve({ portfolios: PORTFOLIOS });
    });
    renderPage();
    await screen.findByTestId('managed-portfolio-row-p2');

    await userEvent.click(screen.getByTestId('restore-portfolio-p2'));
    expect(spy).toHaveBeenCalledWith('/portfolio-admin/portfolios/p2/restore', { method: 'POST' });
    const row = within(screen.getByTestId('managed-portfolio-row-p2'));
    expect(await row.findByText(/already has an active portfolio named "Schwab"/)).toBeInTheDocument();
  });
  test('shows the Flex template name in its own column, and the template filter narrows the list to it', async () => {
    const user = userEvent.setup();
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      portfolios: [
        { id: 'p1', name: 'Fidelity', ownerUserId: 'u1', ownerEmail: 'a@example.com', portfolioType: 'Legacy', templateName: null, status: 'Active', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
        { id: 'p2', name: 'Schwab', ownerUserId: 'u1', ownerEmail: 'a@example.com', portfolioType: 'Flex', templateName: 'Charles-Schwab', status: 'Active', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
        { id: 'p3', name: 'Empower Flex', ownerUserId: 'u2', ownerEmail: 'b@example.com', portfolioType: 'Flex', templateName: 'Empower XLS', status: 'Active', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', holdingsCount: 2, marketValue: 1000 },
      ],
    });
    renderPage();
    const flexRow = await screen.findByTestId('managed-portfolio-row-p2');
    expect(within(flexRow).getByText('Charles-Schwab')).toBeInTheDocument();
    expect(within(screen.getByTestId('managed-portfolio-row-p1')).getByText('—')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('manage-portfolio-filter-template'), 'Empower XLS');
    expect(rowIds()).toEqual(['managed-portfolio-row-p3']);
  });
});
