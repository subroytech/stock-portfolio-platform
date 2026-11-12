import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as client from './client';
import {
  useConfigGroups, useCreateConfigGroup, useUpdateConfigGroup, useConfigProperties,
  useCreateConfigProperty, useUpdateConfigProperty, useSetConfigPropertyValue, useConfigPropertyValueHistory,
} from './configProperties';

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const groupRow = { id: '1', name: 'Data Retention Policies', description: null, createdAt: 'a', updatedAt: 'a' };
const propertyRow = {
  id: '1', groupId: '1', groupName: 'Data Retention Policies', propertyKey: 'contrarian_finder_admin_history_retention_count',
  name: 'Contrarian Finder Admin History Retention Count', description: null, valueType: 'integer' as const,
  minValue: '1', maxValue: '500', status: 'active', currentValue: '60', currentVersion: 1, createdAt: 'a', updatedAt: 'a',
};
const valueRow = {
  id: '2', propertyId: '1', value: '30', version: 2, effectiveTimestamp: 't', isActive: true,
  changedBy: 'user-1', changedByEmail: 'a@b.com', createdAt: 't',
};

describe('useConfigGroups', () => {
  test('GETs /config-properties/groups', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ groups: [groupRow] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useConfigGroups(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/groups');
    expect(result.current.data).toEqual([groupRow]);
  });
});

describe('useCreateConfigGroup', () => {
  test('POSTs the new group and invalidates the groups cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ group: groupRow });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateConfigGroup(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Data Retention Policies', description: null });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Data Retention Policies', description: null }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'groups'] });
  });
});

describe('useUpdateConfigGroup', () => {
  test('PUTs the renamed group and invalidates the groups cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ group: { ...groupRow, name: 'Renamed' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateConfigGroup(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ id: '1', name: 'Renamed', description: null });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/groups/1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Renamed', description: null }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'groups'] });
  });
});

describe('useConfigProperties', () => {
  test('GETs /config-properties/properties with no groupId by default', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ properties: [propertyRow] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useConfigProperties(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties');
    expect(result.current.data).toEqual([propertyRow]);
  });

  test('passes groupId as a query param when provided', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ properties: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useConfigProperties('1'), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties?groupId=1');
  });
});

describe('useCreateConfigProperty', () => {
  test('POSTs the new property and invalidates the properties cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ property: propertyRow });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateConfigProperty(), { wrapper: wrapper(queryClient) });

    const input = {
      groupId: '1', propertyKey: 'max_portfolios_allowed', name: 'Max Portfolios Allowed', description: null,
      valueType: 'integer' as const, minValue: '1', maxValue: '100', initialValue: '10',
    };
    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties', { method: 'POST', body: JSON.stringify(input) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'properties'] });
  });
});

describe('useUpdateConfigProperty', () => {
  test('PUTs the metadata and invalidates the properties cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ property: { ...propertyRow, name: 'Renamed' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateConfigProperty(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ id: '1', name: 'Renamed', description: null, minValue: '1', maxValue: '500', status: 'active' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties/1', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Renamed', description: null, minValue: '1', maxValue: '500', status: 'active' }),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'properties'] });
  });
});

describe('useSetConfigPropertyValue', () => {
  test('PUTs the new value and invalidates both the properties and this property\'s history cache', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ value: valueRow });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSetConfigPropertyValue(), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ id: '1', value: '30' });
    });

    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties/1/value', { method: 'PUT', body: JSON.stringify({ value: '30' }) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'properties'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['configProperties', 'history', '1'] });
  });
});

describe('useConfigPropertyValueHistory', () => {
  test('GETs the version history for a property', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ history: [valueRow] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useConfigPropertyValueHistory('1'), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.apiFetch).toHaveBeenCalledWith('/config-properties/properties/1/history');
    expect(result.current.data).toEqual([valueRow]);
  });

  test('does not fetch when propertyId is null', () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ history: [] });
    spy.mockClear();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useConfigPropertyValueHistory(null), { wrapper: wrapper(queryClient) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(client.apiFetch).not.toHaveBeenCalled();
  });
});
