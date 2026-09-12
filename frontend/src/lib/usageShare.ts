import type { UsageRankingEntry } from '../api/usageAudit';

// Shared by UsagePieChart.tsx and UsageBarChart.tsx (User Usage Dashboard sub-tab) - one entry
// per user, sized by that user's share of combined FMP+Finnhub calls (the same "real API cost"
// metric the ranking list itself sorts by) within whatever ranking slice the caller passes in.
// Zero-usage users are dropped - a 0% pie slice or a 0-height bar shows nothing useful.
export interface UsageShare {
  email: string;
  calls: number;
}

export function usageSharesFromRanking(ranking: UsageRankingEntry[] | undefined): UsageShare[] {
  return (ranking ?? [])
    .map((entry) => ({ email: entry.email, calls: entry.totalFmpCalls + entry.totalFinnhubCalls }))
    .filter((entry) => entry.calls > 0)
    .sort((a, b) => b.calls - a.calls);
}

// Reused verbatim from AllocationChart.tsx's own floral palette - kept as a separate copy (not
// exported/shared from there) since that component is holdings-specific and these are Admin
// Console-specific; the two have no other reason to depend on each other.
export const USAGE_PALETTE = ['#FF4FA0', '#7ED957', '#9B5DE5', '#FF8C42', '#00C2CB', '#FFCA3A', '#FF3B5C', '#3DA9FC', '#D6336C'];
