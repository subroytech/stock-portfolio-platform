import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import { useDeletePortfolio } from './portfolios';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Regression test for a real bug caught live: Confirm Delete (FlexResolutionBanner's
// handleDelete: await mutateAsync(id); onDeleted()) left the deleted portfolio's own
// usePortfolio(id) query still mounted at the moment onSuccess ran (onDeleted(), which
// switches the selected portfolio away, only runs AFTER mutateAsync resolves) - a blanket
// invalidateQueries(['portfolios']) refetched that now-gone portfolio and surfaced a real 404
// in the console.
describe('useDeletePortfolio', () => {
  test('removes (not invalidates) the deleted portfolio\'s own detail query, so it is never refetched', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ success: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['portfolios', '1'], { id: '1', name: 'Deleted Me' });
    queryClient.setQueryData(['portfolios'], [{ id: '1', name: 'Deleted Me' }]);

    const { result } = renderHook(() => useDeletePortfolio(), { wrapper: wrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync('1');
    });

    // The specific deleted portfolio's query is gone entirely - not just stale, not
    // scheduled for a refetch (would 404 if it were).
    expect(queryClient.getQueryState(['portfolios', '1'])).toBeUndefined();
  });

  test('does not touch a different, still-existing portfolio\'s detail query', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ success: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['portfolios', '1'], { id: '1', name: 'Deleted Me' });
    queryClient.setQueryData(['portfolios', '2'], { id: '2', name: 'Still Here' });

    const { result } = renderHook(() => useDeletePortfolio(), { wrapper: wrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync('1');
    });

    expect(queryClient.getQueryData(['portfolios', '2'])).toEqual({ id: '2', name: 'Still Here' });
  });

  test('still invalidates the portfolios list, so it refetches without the deleted one', async () => {
    const mockApiFetch = vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios/1') return Promise.resolve({ success: true });
      return Promise.resolve({ portfolios: [] }); // the list, refetched after invalidation
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A real, active observer - invalidateQueries only triggers an immediate refetch for
    // queries with one, same as the real app (a mounted usePortfolios()).
    renderHook(() => useQuery({ queryKey: ['portfolios'], queryFn: () => client.apiFetch('/portfolios') }), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/portfolios'));
    mockApiFetch.mockClear();

    const { result } = renderHook(() => useDeletePortfolio(), { wrapper: wrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync('1');
    });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/portfolios'));
  });
});
