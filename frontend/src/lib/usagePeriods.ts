import type { UsageRankingEntry } from '../api/usageAudit';

// Shared by UsageDashboardCards.tsx's 3 card components (User Usage Dashboard sub-tab). Kept
// in its own module, separate from the components, so the components file only exports
// components - mixing in plain constants/types there trips the react-refresh lint rule.
export type PeriodOption = 'last3Days' | 'today' | 'yesterday' | 'dayBeforeYesterday';

// today/yesterday/dayBeforeYesterday are labeled "(ET)" - the backend buckets these 3 by
// America/New_York calendar day (found live 2026-09-14: plain UTC bucketing put evening US
// activity under "Yesterday" a few hours before local midnight) - last3Days is a rolling
// 72-hour window with no calendar-day boundary, so it has no timezone to label.
export const PERIOD_LABELS: Record<PeriodOption, string> = {
  last3Days: 'Last 3 Days',
  today: 'Today (ET)',
  yesterday: 'Yesterday (ET)',
  dayBeforeYesterday: 'Day Before Yesterday (ET)',
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
