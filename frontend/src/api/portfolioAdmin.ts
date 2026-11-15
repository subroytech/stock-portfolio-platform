import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { PortfolioStatus } from './portfolios';

// Admin - Portfolio Admin - Manage Portfolio (portfolio_admin:manage). Backs /portfolio-admin/*.

export type ManagedPortfolioType = 'Legacy' | 'Flex';

export interface ManagedPortfolio {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  portfolioType: ManagedPortfolioType;
  // Flex template this portfolio is bound to; null for Legacy, and for a Flex portfolio not yet saved as a template.
  templateName: string | null;
  status: PortfolioStatus;
  createdAt: string;
}

export const MANAGED_PORTFOLIOS_QUERY_KEY = ['portfolio-admin', 'portfolios'] as const;

// Loads every portfolio across all statuses. The page filters this list client-side (single-select
// filters), so the User dropdown can be built from the same data without a second request.
export function useManagedPortfolios() {
  return useQuery({
    queryKey: MANAGED_PORTFOLIOS_QUERY_KEY,
    queryFn: () => apiFetch<{ portfolios: ManagedPortfolio[] }>('/portfolio-admin/portfolios').then((r) => r.portfolios),
  });
}

// Restores a Soft-Delete portfolio to Active. A 409 (wrong state, or the name is already taken)
// surfaces the server's own message through ApiError.
export function useRestorePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ portfolio: unknown }>(`/portfolio-admin/portfolios/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGED_PORTFOLIOS_QUERY_KEY });
      // The owner's own Portfolio tab reads this key, so a restored portfolio reappears there too.
      queryClient.invalidateQueries({ queryKey: ['portfolios'], exact: true });
    },
  });
}

// Permanent delete - irreversible. Only a Soft-Delete portfolio is accepted by the server.
export function usePermanentlyDeletePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ success: true }>(`/portfolio-admin/portfolios/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGED_PORTFOLIOS_QUERY_KEY });
    },
  });
}
