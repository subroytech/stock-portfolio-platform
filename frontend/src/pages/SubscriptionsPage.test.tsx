import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SubscriptionsPage from './SubscriptionsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionsPage />
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage', () => {
  test('lists FMP, Finnhub, and Anthropic, each with its own consuming-feature note', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
    renderPage();
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText('used by Long-Term Analysis for news')).toBeInTheDocument();
    expect(screen.getByText('Anthropic (Claude)')).toBeInTheDocument();
    expect(screen.getByText("used by Candlestick Pattern Q&A's free-text Ask")).toBeInTheDocument();
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
});
