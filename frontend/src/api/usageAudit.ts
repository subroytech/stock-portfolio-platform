import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// User Usage Dashboard (2026-09-05) - the first read/reporting surface over the Usage Audit
// data that's been write-only since it was built. UsageFeature mirrors backend/src/services/
// usageTracking.service.ts's own type exactly.
export type UsageFeature = 'momentum' | 'contrarian_finder_scan' | 'long_term_analysis'
  | 'contrarian_comeback' | 'portfolio_refresh' | 'stock_preview';

export interface FeatureUsage {
  functionCalls: number;
  fmpCalls: number;
  finnhubCalls: number;
}

export interface UsageRankingEntry {
  userId: string;
  email: string;
  roles: string[];
  totalFunctionCalls: number;
  totalFmpCalls: number;
  totalFinnhubCalls: number;
  byFeature: Partial<Record<UsageFeature, FeatureUsage>>;
}

export function useUsageLast3Days() {
  return useQuery({
    queryKey: ['usageAudit', 'last3Days'],
    queryFn: () => apiFetch<{ ranking: UsageRankingEntry[] }>('/usage-audit/last-3-days').then((r) => r.ranking),
  });
}

// Dashboard sub-tab's per-card day picker (2026-09-12). offset: 0 = today, 1 = yesterday,
// 2 = day before yesterday - mirrors backend's UsageDayOffset exactly.
export type UsageDayOffset = 0 | 1 | 2;

export function useUsageForDay(offset: UsageDayOffset) {
  return useQuery({
    queryKey: ['usageAudit', 'day', offset],
    queryFn: () => apiFetch<{ offset: number; ranking: UsageRankingEntry[] }>(`/usage-audit/day?offset=${offset}`).then((r) => r.ranking),
  });
}

export function useUsageForMonth(month: string) {
  return useQuery({
    queryKey: ['usageAudit', 'monthly', month],
    queryFn: () => apiFetch<{ month: string; ranking: UsageRankingEntry[]; dataCutoff: string | null }>(`/usage-audit/monthly?month=${month}`),
  });
}

export function useAvailableUsageMonths() {
  return useQuery({
    queryKey: ['usageAudit', 'availableMonths'],
    queryFn: () => apiFetch<{ months: string[] }>('/usage-audit/available-months').then((r) => r.months),
  });
}
