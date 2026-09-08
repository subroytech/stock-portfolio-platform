import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from './client';
import { useStockPreview } from './stockPreview';

// Regression test for a real bug found live: React StrictMode's dev-only mount/unmount/remount
// cycle fired this query twice on first paint, and since the fetch was never actually
// cancellable, both "phantom" and real mounts completed as genuine HTTP requests - invisible
// before this endpoint had usage tracking, but showing up as inflated stock_preview counts once
// it did. Passing queryFn's own AbortSignal through to apiFetch is what lets React Query
// actually cancel a superseded request instead of letting it run to completion.
describe('useStockPreview', () => {
  test('passes an AbortSignal through to apiFetch so a superseded request can actually be cancelled', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ symbol: 'AAPL', quote: null, historical: [] });
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useStockPreview('AAPL'), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith('/stock-preview/AAPL', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
