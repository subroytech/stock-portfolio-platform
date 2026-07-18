import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import SubscriptionsPage from './SubscriptionsPage';

// A fresh QueryClient per render — the app's shared singleton would leak
// cached ['subscriptions'] data between these tests.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubscriptionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage', () => {
  test('lists FMP as active and Finnhub as not used by any feature yet', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ subscriptions: [] });
    renderPage();
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText('not used by any feature yet')).toBeInTheDocument();
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
