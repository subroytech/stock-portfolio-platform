import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface MaskedSubscription {
  provider: string;
  maskedKey: string;
  planTier: string | null;
  status: string;
  renewalDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useSubscriptions() {
  return useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => apiFetch<{ subscriptions: MaskedSubscription[] }>('/subscriptions').then((r) => r.subscriptions),
  });
}

export function useUpsertSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string; apiKey: string; planTier?: string | null }) => apiFetch<{ subscription: MaskedSubscription }>(`/subscriptions/${input.provider}`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey: input.apiKey, planTier: input.planTier }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => apiFetch<{ success: true }>(`/subscriptions/${provider}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
}
