import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import RateLimitIndicator from './RateLimitIndicator';
import type { RateLimitStatusResponse } from '../api/rateLimitStatus';

function renderIndicator() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RateLimitIndicator />
    </QueryClientProvider>,
  );
}

function mockStatus(overrides: Partial<RateLimitStatusResponse> = {}) {
  return vi.spyOn(client, 'apiFetch').mockResolvedValue({
    exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 17, remaining: 33, ...overrides,
  });
}

describe('RateLimitIndicator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('renders nothing while loading', () => {
    mockStatus();
    renderIndicator();
    expect(screen.queryByTestId('rate-limit-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rate-limit-blocked')).not.toBeInTheDocument();
  });

  test('shows the green (i) badge with "X of Y Left" when under budget', async () => {
    mockStatus({ remaining: 33, limit: 50 });
    renderIndicator();
    const badge = await screen.findByTestId('rate-limit-ok');
    expect(badge).toHaveTextContent('(i)');
    expect(badge).toHaveAttribute('title', '33 of 50 Left');
  });

  test('shows the red W badge with the wait-time tooltip once exhausted', async () => {
    mockStatus({ remaining: 0, limit: 50, windowMinutes: 5 });
    renderIndicator();
    const badge = await screen.findByTestId('rate-limit-blocked');
    expect(badge).toHaveTextContent('W');
    expect(badge).toHaveAttribute('title', 'Wait 5 minutes for your Limit Refresh');
    expect(screen.queryByTestId('rate-limit-ok')).not.toBeInTheDocument();
  });

  test('renders nothing for an exempt (admin/admin-master) session', async () => {
    mockStatus({ exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0, remaining: null });
    renderIndicator();
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('rate-limit-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rate-limit-blocked')).not.toBeInTheDocument();
  });
});
