import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import { useFunctions, useCreateFunction, useUpdateFunctionStatus } from './functions';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const fnRow = { id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' as const };

describe('useFunctions', () => {
  test('defaults to GET /functions (activeOnly)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ functions: [fnRow] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFunctions(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/functions');
    expect(result.current.data).toEqual([fnRow]);
  });

  test('activeOnly: false calls GET /functions?all=true', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ functions: [fnRow] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFunctions({ activeOnly: false }), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/functions?all=true');
  });
});

describe('useCreateFunction', () => {
  test('POSTs the new function and invalidates the functions cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ function: { ...fnRow, id: '2' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateFunction(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/functions', {
      method: 'POST',
      body: JSON.stringify({ permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['functions'] });
  });
});

describe('useUpdateFunctionStatus', () => {
  test('PUTs the new status and invalidates the functions cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ function: { ...fnRow, status: 'inactive' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateFunctionStatus(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ id: '1', status: 'inactive' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/functions/1', { method: 'PUT', body: JSON.stringify({ status: 'inactive' }) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['functions'] });
  });
});
