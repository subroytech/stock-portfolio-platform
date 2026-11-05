import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as client from './client';
import { ApiError } from './client';
import { useStockPreview } from './stockPreview';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  test('never retries a 429 (shared rate limit exhausted) - it won\'t have cleared by the next attempt', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(429, 'You\'ve reached the limit of 10 new requests per 10 minutes. Please try again shortly.', null));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useStockPreview('AAPL'), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(spy).toHaveBeenCalledTimes(1);
    expect((result.current.error as ApiError).message).toContain('10 new requests per 10 minutes');
  });

  test('still retries once for a non-429 error, matching the app-wide default', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(500, 'Internal error.', null));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useStockPreview('AAPL'), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    // The single retry's own default backoff delay (1000ms for the first retry) is close to
    // testing-library's default waitFor timeout, so this one needs a longer explicit window.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
