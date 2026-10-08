import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import { useUsersWithRoles, useUpdateUserRole, useCreateUser, useUpdateUserStatus } from './users';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useUsersWithRoles', () => {
  test('calls GET /users and returns the user list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      users: [{ id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: ['fmp'], status: 'active' }],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useUsersWithRoles(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/users');
    expect(result.current.data).toEqual([{ id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: ['fmp'], status: 'active' }]);
  });
});

describe('useUpdateUserRole', () => {
  test('PUTs the new role and invalidates the users list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '2', roles: ['admin'] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateUserRole(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ userId: '2', role: 'admin' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/users/2/role', {
      method: 'PUT',
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
  });
});

describe('useCreateUser', () => {
  test('POSTs the new user and invalidates the users list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '5', email: 'new@b.com', status: 'active', roles: ['user'] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateUser(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ email: 'new@b.com', password: 'longenoughpassword', status: 'active', role: 'user' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@b.com', password: 'longenoughpassword', status: 'active', role: 'user' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
  });
});

describe('useUpdateUserStatus', () => {
  test('PUTs the new status and invalidates the users list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ id: '2', status: 'deactivated' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateUserStatus(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ userId: '2', status: 'deactivated' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/users/2/status', {
      method: 'PUT',
      body: JSON.stringify({ status: 'deactivated' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] });
  });
});
