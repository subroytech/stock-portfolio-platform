import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type ConfigValueType = 'integer' | 'string';

export interface ConfigGroup {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigProperty {
  id: string;
  groupId: string;
  groupName: string;
  propertyKey: string;
  name: string;
  description: string | null;
  valueType: ConfigValueType;
  minValue: string | null;
  maxValue: string | null;
  status: string;
  currentValue: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigPropertyValue {
  id: string;
  propertyId: string;
  value: string;
  version: number;
  effectiveTimestamp: string;
  isActive: boolean;
  changedBy: string | null;
  changedByEmail: string | null;
  createdAt: string;
}

export function useConfigGroups() {
  return useQuery({
    queryKey: ['configProperties', 'groups'],
    queryFn: () => apiFetch<{ groups: ConfigGroup[] }>('/config-properties/groups').then((r) => r.groups),
  });
}

export function useCreateConfigGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description: string | null }) => apiFetch<{ group: ConfigGroup }>('/config-properties/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'groups'] });
    },
  });
}

export function useUpdateConfigGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string; description: string | null }) => apiFetch<{ group: ConfigGroup }>(`/config-properties/groups/${input.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: input.name, description: input.description }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'groups'] });
    },
  });
}

// GET /config-properties/properties[?groupId=] — omitting groupId lists every property across
// every group (the Admin Console page's default view).
export function useConfigProperties(groupId?: string) {
  return useQuery({
    queryKey: ['configProperties', 'properties', groupId ?? ''],
    queryFn: () => apiFetch<{ properties: ConfigProperty[] }>(`/config-properties/properties${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`).then((r) => r.properties),
  });
}

export function useCreateConfigProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      groupId: string;
      propertyKey: string;
      name: string;
      description: string | null;
      valueType: ConfigValueType;
      minValue: string | null;
      maxValue: string | null;
      initialValue: string;
    }) => apiFetch<{ property: ConfigProperty }>('/config-properties/properties', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'properties'] });
    },
  });
}

export function useUpdateConfigProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name: string;
      description: string | null;
      minValue: string | null;
      maxValue: string | null;
      status: string;
    }) => apiFetch<{ property: ConfigProperty }>(`/config-properties/properties/${input.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: input.name, description: input.description, minValue: input.minValue, maxValue: input.maxValue, status: input.status }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'properties'] });
    },
  });
}

export function useSetConfigPropertyValue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; value: string }) => apiFetch<{ value: ConfigPropertyValue }>(`/config-properties/properties/${input.id}/value`, {
      method: 'PUT',
      body: JSON.stringify({ value: input.value }),
    }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'properties'] });
      queryClient.invalidateQueries({ queryKey: ['configProperties', 'history', variables.id] });
    },
  });
}

export function useConfigPropertyValueHistory(propertyId: string | null) {
  return useQuery({
    queryKey: ['configProperties', 'history', propertyId],
    queryFn: () => apiFetch<{ history: ConfigPropertyValue[] }>(`/config-properties/properties/${propertyId}/history`).then((r) => r.history),
    enabled: propertyId !== null,
  });
}
