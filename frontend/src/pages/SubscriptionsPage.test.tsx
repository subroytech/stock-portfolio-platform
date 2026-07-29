import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SubscriptionsPage from './SubscriptionsPage';

// A fresh QueryClient per render — the app's shared singleton would leak
// cached ['subscriptions'] data between these tests.
function renderPage(onClose: () => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionsPage onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage', () => {
  test('lists FMP and Finnhub, noting Finnhub is used by Long-Term Analysis for news', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
    renderPage();
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText('used by Long-Term Analysis for news')).toBeInTheDocument();
  });

  test('shows the masked key when a subscription already exists', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      subscriptions: [{
        provider: 'fmp', maskedKey: '••••••••wxyz', planTier: null, status: 'active',
        renewalDate: null, createdAt: 't1', updatedAt: 't1',
      }],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Key on file: ••••••••wxyz/)).toBeInTheDocument());
  });

  test('the Close button calls onClose', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
    const onClose = vi.fn();
    renderPage(onClose);
    await screen.findByText('FMP (Financial Modeling Prep)');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
