import type { UsageRankingEntry } from '../api/usageAudit';

// Shared by UsageDashboardCards.tsx's 3 card components (User Usage Dashboard sub-tab). Kept
// in its own module, separate from the components, so the components file only exports
// components - mixing in plain constants/types there trips the react-refresh lint rule.
export type PeriodOption = 'last3Days' | 'today' | 'yesterday' | 'dayBeforeYesterday';

export const PERIOD_LABELS: Record<PeriodOption, string> = {
  last3Days: 'Last 3 Days',
  today: 'Today',
  yesterday: 'Yesterday',
  dayBeforeYesterday: 'Day Before Yesterday',
};

export const PERIOD_OPTIONS = Object.keys(PERIOD_LABELS) as PeriodOption[];

interface PeriodQuery {
  data: UsageRankingEntry[] | undefined;
  isLoading: boolean;
}

// The 4 day-based datasets (Last 3 Days / Today / Yesterday / Day Before Yesterday) are fetched
// once, up front, at the page level and shared as-is across every card that might need one of
// them - only each card's *selection* of which one to show is its own independent state.
export interface PeriodDatasets {
  last3Days: PeriodQuery;
  today: PeriodQuery;
  yesterday: PeriodQuery;
  dayBeforeYesterday: PeriodQuery;
}
