import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import { ApiError } from './client';
import { useSession, useLogin, useSignup, useLogout } from './auth';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSession', () => {
  test('calls GET /auth/me and returns the full user (including roles)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '1', email: 'a@b.com', roles: ['user'] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/auth/me');
    expect(result.current.data).toEqual({ id: '1', email: 'a@b.com', roles: ['user'] });
  });

  test('a 401 from /auth/me resolves to null, not an error (no session)', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(401, 'Authentication required.', null));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useLogin', () => {
  test('chains POST /auth/login with a GET /auth/me call and populates the session synchronously with the full result', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/auth/login') return Promise.resolve({ user: { id: '1', email: 'a@b.com' } });
      if (path === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user', 'admin'] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ email: 'a@b.com', password: 'whatever123' });
    });

    // setQueryData happened as part of onSuccess, synchronously available
    // the moment mutateAsync resolves - no flash of stale/null session data.
    expect(queryClient.getQueryData(['session'])).toEqual({ id: '1', email: 'a@b.com', roles: ['user', 'admin'] });
  });
});

describe('useSignup', () => {
  test('chains POST /auth/signup with a GET /auth/me call the same way', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/auth/signup') return Promise.resolve({ user: { id: '2', email: 'new@b.com' } });
      if (path === '/auth/me') return Promise.resolve({ id: '2', email: 'new@b.com', roles: ['user'] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSignup(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ email: 'new@b.com', password: 'whatever123' });
    });

    expect(queryClient.getQueryData(['session'])).toEqual({ id: '2', email: 'new@b.com', roles: ['user'] });
  });
});

describe('useLogout', () => {
  // Regression test: session must be set to null SYNCHRONOUSLY in onSuccess (before the
  // deferred clear()), and clear() must be deferred past the current render/commit (a real
  // setTimeout(0)) - not run clear() first/synchronously. That older ordering left any
  // still-mounted query observer (session's own, or e.g. Dashboard's /portfolios) with no
  // cached data ("needs fetching") for one moment, which immediately re-fired a real request
  // - 401ing since the server had just cleared the auth cookie.
  //
  // Uses fake timers advanced by exactly 0ms, not a real wall-clock wait (the previous
  // version's flakiness - confirmed genuinely failing in CI 2026-08-02, not just a
  // local-machine timing quirk: waiting a fixed 10ms and hoping the deferred callback has
  // fired by then isn't guaranteed under a CI runner's own scheduling) and not
  // vi.runAllTimers() (tried first - runs every pending timer recursively, including React
  // Query's own ~5min gcTime eviction timer, which garbage-collected the unobserved
  // ['session'] entry entirely and made it read back as undefined instead of null).
  // advanceTimersByTimeAsync(0) only fires what's already due at t+0 (our deferred
  // setTimeout(0) and React Query's own 0ms notification-batching calls), leaving the
  // far-future gcTime timer untouched.
  test('session is null immediately; other cached queries are cleared only once the deferred callback runs', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(client, 'apiFetch').mockResolvedValue({ success: true });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(['session'], { id: '1', email: 'a@b.com', roles: ['user'] });
      queryClient.setQueryData(['portfolios'], { portfolios: [{ id: '1' }] });
      const { result } = renderHook(() => useLogout(), { wrapper: wrapper(queryClient) });

      await act(async () => {
        await result.current.mutateAsync();
      });

      // Immediately after mutateAsync resolves (before the deferred callback runs): session
      // already null, but portfolios hasn't been cleared yet - proving the order isn't "clear
      // everything at once."
      expect(queryClient.getQueryData(['session'])).toBeNull();
      expect(queryClient.getQueryData(['portfolios'])).toEqual({ portfolios: [{ id: '1' }] });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(queryClient.getQueryData(['session'])).toBeNull();
      expect(queryClient.getQueryState(['session'])).toBeDefined(); // present (null), not removed
      expect(queryClient.getQueryData(['portfolios'])).toBeUndefined(); // cleared once the deferred callback ran
    } finally {
      vi.useRealTimers();
    }
  });
});
