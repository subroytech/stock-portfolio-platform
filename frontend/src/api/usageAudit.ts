import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// User Usage Dashboard (2026-09-05) - the first read/reporting surface over the Usage Audit
// data that's been write-only since it was built. UsageFeature mirrors backend/src/services/
// usageTracking.service.ts's own type exactly.
export type UsageFeature = 'momentum' | 'contrarian_finder_scan' | 'long_term_analysis'
  | 'contrarian_comeback' | 'portfolio_refresh';

export interface UsageRankingEntry {
  userId: string;
  email: string;
  totalScore: number;
  byFeature: Partial<Record<UsageFeature, number>>;
}

export function useUsageLast3Days() {
  return useQuery({
    queryKey: ['usageAudit', 'last3Days'],
    queryFn: () => apiFetch<{ ranking: UsageRankingEntry[] }>('/usage-audit/last-3-days').then((r) => r.ranking),
  });
}

export function useUsageForMonth(month: string) {
  return useQuery({
    queryKey: ['usageAudit', 'monthly', month],
    queryFn: () => apiFetch<{ month: string; ranking: UsageRankingEntry[] }>(`/usage-audit/monthly?month=${month}`).then((r) => r.ranking),
  });
}

export function useAvailableUsageMonths() {
  return useQuery({
    queryKey: ['usageAudit', 'availableMonths'],
    queryFn: () => apiFetch<{ months: string[] }>('/usage-audit/available-months').then((r) => r.months),
  });
}
