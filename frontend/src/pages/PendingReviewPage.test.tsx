import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import PendingReviewPage from './PendingReviewPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PendingReviewPage />
    </QueryClientProvider>,
  );
}

describe('PendingReviewPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('shows the under-review message', () => {
    renderPage();
    expect(screen.getByTestId('pending-review-banner')).toHaveTextContent(
      'Your Registration Request is under Review and will get activated Soon. Thanks for your patience.',
    );
  });

  test('Log out calls POST /auth/logout', async () => {
    const apiFetch = vi.spyOn(client, 'apiFetch').mockResolvedValue({ success: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(apiFetch).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});
