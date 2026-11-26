import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import PortfolioSelector from './PortfolioSelector';
import type { PortfolioSummary } from '../api/portfolios';

const portfolios: PortfolioSummary[] = [
  { id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: null, status: 'Active' },
];

function renderSelector() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortfolioSelector selectedId={null} onSelect={() => {}} />
    </QueryClientProvider>,
  );
}

describe('PortfolioSelector rename', () => {
  test('renaming a portfolio calls PUT /portfolios/:id and shows the updated name', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(client, 'apiFetch').mockImplementation((path) => {
      if (path === '/portfolios') return Promise.resolve({ portfolios });
      if (path === '/portfolios/1') {
        return Promise.resolve({ portfolio: { ...portfolios[0], name: 'Fidelity Retirement' } });
      }
      return Promise.reject(new Error(`unexpected call: ${path}`));
    });

    renderSelector();
    expect(await screen.findByText('Fidelity')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename Fidelity' }));
    const input = screen.getByDisplayValue('Fidelity');
    await user.clear(input);
    await user.type(input, 'Fidelity Retirement');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/portfolios/1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ name: 'Fidelity Retirement' }),
    })));
  });
});

describe('PortfolioSelector soft delete (owner Delete action)', () => {
  test('the trash icon in the edit form shows the warning, and confirming posts a soft delete', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(client, 'apiFetch').mockImplementation((path) => {
      if (path === '/portfolios') return Promise.resolve({ portfolios });
      if (path === '/portfolios/1/soft-delete') return Promise.resolve({ success: true });
      return Promise.reject(new Error());
    });

    renderSelector();
    expect(await screen.findByText('Fidelity')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename Fidelity' }));
    await user.click(screen.getByTestId('delete-portfolio-1'));

    const warning = screen.getByTestId('delete-portfolio-warning');
    expect(warning).toHaveTextContent('This will remove the portfolio Fidelity.');
    expect(warning).toHaveTextContent('raise a support ticket');
    expect(warning).toHaveTextContent('restoration may not be guaranteed');
    expect(fetchSpy).not.toHaveBeenCalledWith('/portfolios/1/soft-delete', expect.anything());

    await user.click(screen.getByTestId('delete-portfolio-confirm'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/portfolios/1/soft-delete', { method: 'POST' }));
  });

  test('Cancel on the warning sends nothing', async () => {
    vi.restoreAllMocks(); // the previous test's soft-delete call must not count against this one
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(client, 'apiFetch').mockImplementation((path) => {
      if (path === '/portfolios') return Promise.resolve({ portfolios });
      return Promise.reject(new Error());
    });

    renderSelector();
    expect(await screen.findByText('Fidelity')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename Fidelity' }));
    await user.click(screen.getByTestId('delete-portfolio-1'));
    await user.click(within(screen.getByTestId('delete-portfolio-warning')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('delete-portfolio-warning')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith('/portfolios/1/soft-delete', expect.anything());
  });
});
