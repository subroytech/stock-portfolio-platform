import type { UsageFeature, UsageRankingEntry, FeatureUsage } from '../api/usageAudit';

// Shared by UsagePieChart.tsx (User Usage Dashboard sub-tab) - one entry per user, sized by
// that user's share of combined FMP+Finnhub calls (the same "real API cost" metric the ranking
// list itself sorts by) within whatever ranking slice the caller passes in. Zero-usage users
// are dropped - a 0% pie slice shows nothing useful.
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

// Shared by UsageAuditPage.tsx's per-user breakdown rows and usageSharesByFeature() below - the
// one hand-maintained mapping from UsageFeature to a human label, kept here (not duplicated
// locally in the page) since the bar chart now needs it too.
export const FEATURE_LABELS: Record<UsageFeature, string> = {
  momentum: 'Momentum Analysis',
  contrarian_finder_scan: 'Contrarian Finder',
  long_term_analysis: 'Long-Term Analysis',
  contrarian_comeback: 'Contrarian Comeback',
  portfolio_refresh: 'Portfolio Refresh',
  stock_preview: 'Stock Preview',
  quotes: 'Quotes',
};

// UsageBarChart.tsx (Dashboard sub-tab, Chart-3 per row) - unlike the pie charts, the bar chart
// groups by function/feature, not by user: summed across every user in whatever role-filtered
// ranking slice the caller passes in (Non-Admin vs. Admin/Admin-Master), same combined
// FMP+Finnhub "real API cost" metric. A feature with zero calls in this slice is dropped, same
// as a zero-usage user above.
export interface UsageFeatureShare {
  feature: UsageFeature;
  label: string;
  calls: number;
}

export function usageSharesByFeature(ranking: UsageRankingEntry[] | undefined): UsageFeatureShare[] {
  const totals = new Map<UsageFeature, number>();
  for (const entry of ranking ?? []) {
    for (const [feature, usage] of Object.entries(entry.byFeature) as [UsageFeature, FeatureUsage][]) {
      totals.set(feature, (totals.get(feature) ?? 0) + usage.fmpCalls + usage.finnhubCalls);
    }
  }
  return [...totals.entries()]
    .map(([feature, calls]) => ({ feature, label: FEATURE_LABELS[feature], calls }))
    .filter((entry) => entry.calls > 0)
    .sort((a, b) => b.calls - a.calls);
}

// Reused verbatim from AllocationChart.tsx's own floral palette - kept as a separate copy (not
// exported/shared from there) since that component is holdings-specific and these are Admin
// Console-specific; the two have no other reason to depend on each other.
export const USAGE_PALETTE = ['#FF4FA0', '#7ED957', '#9B5DE5', '#FF8C42', '#00C2CB', '#FFCA3A', '#FF3B5C', '#3DA9FC', '#D6336C'];
