import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// Flex Portfolio quota UX polish (2026-09-06) - lets the Create Portfolio/Save Template flows
// show a live current/limit indicator and disable submission before a 409 would fire, instead
// of only explaining it after.
export interface QuotaMetric {
  current: number;
  limit: number;
}

export interface FlexQuotaStatus {
  pendingTemplates: QuotaMetric;
  approvedTemplates: QuotaMetric;
  flexPortfolios: QuotaMetric;
}

export const FLEX_QUOTA_STATUS_QUERY_KEY = ['flexQuota', 'status'];

export function useFlexQuotaStatus() {
  return useQuery({
    queryKey: FLEX_QUOTA_STATUS_QUERY_KEY,
    queryFn: () => apiFetch<FlexQuotaStatus>('/flex-quota/status'),
  });
}

export function isAtOrOverLimit(metric: QuotaMetric): boolean {
  return metric.current >= metric.limit;
}
