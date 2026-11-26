import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import { useRoles, useCreateRole, useRolePermissions, useGrantPermission, useRevokePermission } from './roles';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRoles', () => {
  test('calls GET /roles and returns the role list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      roles: [{ id: '1', name: 'user' }, { id: '2', name: 'admin' }],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRoles(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/roles');
    expect(result.current.data).toEqual([{ id: '1', name: 'user' }, { id: '2', name: 'admin' }]);
  });
});

describe('useCreateRole', () => {
  test('POSTs the new role name and invalidates the roles list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ role: { id: '3', name: 'analyst' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRole(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync('analyst');
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/roles', { method: 'POST', body: JSON.stringify({ name: 'analyst' }) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['roles'] });
  });
});

describe('useRolePermissions', () => {
  test('calls GET /roles/:id/permissions when a roleId is given', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ permissions: ['roles:manage'] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRolePermissions('2'), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/roles/2/permissions');
    expect(result.current.data).toEqual(['roles:manage']);
  });

  test('is disabled (no fetch) when roleId is null', () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ permissions: [] });
    spy.mockClear(); // earlier tests in this file share the same spied module export
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useRolePermissions(null), { wrapper: wrapper(queryClient) });
    expect(client.apiFetch).not.toHaveBeenCalled();
  });
});

describe('useGrantPermission / useRevokePermission', () => {
  test('useGrantPermission POSTs and updates the cached permission list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ permissions: ['functions:manage'] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useGrantPermission('2'), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync('functions:manage');
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/roles/2/permissions', { method: 'POST', body: JSON.stringify({ permissionKey: 'functions:manage' }) });
    expect(queryClient.getQueryData(['rolePermissions', '2'])).toEqual(['functions:manage']);
  });

  test('useRevokePermission DELETEs and updates the cached permission list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ permissions: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRevokePermission('2'), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync('functions:manage');
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/roles/2/permissions/functions:manage', { method: 'DELETE' });
    expect(queryClient.getQueryData(['rolePermissions', '2'])).toEqual([]);
  });
});
