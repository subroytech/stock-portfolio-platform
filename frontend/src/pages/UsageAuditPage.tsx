import { useState } from 'react';
import {
  useUsageLast3Days, useUsageForMonth, useAvailableUsageMonths,
  type UsageRankingEntry, type UsageFeature,
} from '../api/usageAudit';

const FEATURE_LABELS: Record<UsageFeature, string> = {
  momentum: 'Momentum Analysis',
  contrarian_finder_scan: 'Contrarian Finder',
  long_term_analysis: 'Long-Term Analysis',
  contrarian_comeback: 'Contrarian Comeback',
  portfolio_refresh: 'Portfolio Refresh',
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7) + '-01';
}

function formatMonthLabel(month: string): string {
  return new Date(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

interface RankingListProps {
  ranking: UsageRankingEntry[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
}

// Shared between both sub-tabs - same data shape (UsageRankingEntry[]), already sorted
// descending by the backend. A plain CSS width-percentage bar (relative to the top user's
// score) rather than pulling in a charting library for a one-off visual, consistent with the
// rest of the Admin Console's plain-Tailwind style.
function RankingList({ ranking, isLoading, emptyMessage }: RankingListProps) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (!ranking || ranking.length === 0) return <p className="text-sm text-text-secondary">{emptyMessage}</p>;

  const topScore = Math.max(...ranking.map((r) => r.totalScore), 1);

  return (
    <div className="flex flex-col gap-2">
      {ranking.map((entry, i) => {
        const expanded = expandedUserId === entry.userId;
        const features = Object.entries(entry.byFeature) as [UsageFeature, number][];
        return (
          <div key={entry.userId} className="rounded-card bg-bg-card p-3 shadow-card" data-testid={`usage-row-${entry.userId}`}>
            <button
              type="button"
              onClick={() => setExpandedUserId(expanded ? null : entry.userId)}
              className="flex w-full items-center gap-3 text-left"
            >
              <span className="w-6 flex-none text-sm font-semibold text-text-muted">#{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{entry.email}</span>
              <span className="w-16 flex-none text-right text-sm font-semibold text-text-primary" data-testid={`usage-score-${entry.userId}`}>
                {entry.totalScore}
              </span>
            </button>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-primary">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(entry.totalScore / topScore) * 100}%` }}
              />
            </div>
            {expanded && (
              <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2" data-testid={`usage-breakdown-${entry.userId}`}>
                {features.length === 0 && <p className="text-xs text-text-secondary">No activity in this period.</p>}
                {features.map(([feature, score]) => (
                  <div key={feature} className="flex items-center justify-between text-xs text-text-secondary">
                    <span>{FEATURE_LABELS[feature]}</span>
                    <span className="font-medium text-text-primary">{score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Admin Console "User Usage" tab - the first read/reporting surface over the Usage Audit data
// (write side built earlier, never had a view before this). Two sub-tabs: Last 3 Days
// (default) and Monthly.
export default function UsageAuditPage() {
  const [activeSubTab, setActiveSubTab] = useState<'last3Days' | 'monthly'>('last3Days');
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());

  const last3Days = useUsageLast3Days();
  const monthly = useUsageForMonth(selectedMonth);
  const { data: availableMonths } = useAvailableUsageMonths();

  // The current month is always selectable even if it has no rows yet (a brand-new month
  // starts with zero completed events) - degrades to an all-zero ranking, not a missing option.
  const monthOptions = availableMonths?.includes(currentMonth())
    ? availableMonths
    : [currentMonth(), ...(availableMonths ?? [])];

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('last3Days')}
          className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
            activeSubTab === 'last3Days' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
          }`}
        >
          Last 3 Days
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('monthly')}
          className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors ${
            activeSubTab === 'monthly' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
          }`}
        >
          Monthly
        </button>
      </nav>

      {activeSubTab === 'last3Days' && (
        <RankingList
          ranking={last3Days.data}
          isLoading={last3Days.isLoading}
          emptyMessage="No users to show."
        />
      )}

      {activeSubTab === 'monthly' && (
        <>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Select month"
            className="w-48 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            {monthOptions.map((m) => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
          </select>
          <RankingList
            ranking={monthly.data}
            isLoading={monthly.isLoading}
            emptyMessage="No usage recorded for this month."
          />
        </>
      )}
    </div>
  );
}
