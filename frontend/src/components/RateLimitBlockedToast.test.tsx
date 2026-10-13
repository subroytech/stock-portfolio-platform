import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import RateLimitBlockedToast from './RateLimitBlockedToast';
import type { RateLimitStatusResponse } from '../api/rateLimitStatus';

function renderToast(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RateLimitBlockedToast />
    </QueryClientProvider>,
  );
}

function mockStatus(response: RateLimitStatusResponse) {
  return vi.spyOn(client, 'apiFetch').mockResolvedValue(response);
}

describe('RateLimitBlockedToast', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('does not show when within budget', async () => {
    mockStatus({ exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 10, remaining: 40 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderToast(queryClient);
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('rate-limit-blocked-toast')).not.toBeInTheDocument();
  });

  test('shows once the moment the status transitions from within-budget to exhausted', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockStatus({ exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 49, remaining: 1 });
    renderToast(queryClient);
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('rate-limit-blocked-toast')).not.toBeInTheDocument();

    // Simulate the query settling into the exhausted state (e.g. after another action's own
    // invalidation refetch), same query key so the same component instance picks it up.
    queryClient.setQueryData(['rateLimitStatus'], { exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 50, remaining: 0 });

    const toast = await screen.findByTestId('rate-limit-blocked-toast');
    expect(toast).toHaveTextContent('Wait 5 minutes for your limit to refresh');
  });

  test('never shows for an exempt session', async () => {
    mockStatus({ exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0, remaining: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderToast(queryClient);
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('rate-limit-blocked-toast')).not.toBeInTheDocument();
  });
});
