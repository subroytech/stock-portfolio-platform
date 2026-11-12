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

// "Get Allowed Models" (2026-10-08) - tests whatever key is currently typed/pasted by default,
// or (useSavedKey: true) the caller's own already-saved key, decrypted server-side and never
// returned here - either way, this never needs to invalidate or touch the subscriptions cache
// above, since it's a read against the provider's own API, not this app's stored data.
export function useListAllowedModels() {
  return useMutation({
    mutationFn: (input: { provider: string; apiKey?: string; useSavedKey?: boolean }) => apiFetch<{ models: string[] }>(`/subscriptions/${input.provider}/models`, {
      method: 'POST',
      body: JSON.stringify({ apiKey: input.apiKey, useSavedKey: input.useSavedKey }),
    }).then((r) => r.models),
  });
}
