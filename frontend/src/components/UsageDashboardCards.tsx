import { useState } from 'react';
import { useUsageForMonth, type UsageRankingEntry } from '../api/usageAudit';
import UsagePieBody from './UsagePieChart';
import UsageBarBody from './UsageBarChart';
import { currentMonth, formatMonthLabel } from '../lib/usageDates';
import { PERIOD_LABELS, PERIOD_OPTIONS, type PeriodOption, type PeriodDatasets } from '../lib/usagePeriods';

function CardShell({ testId, children }: { testId: string; children: React.ReactNode }) {
  return <div className="flex h-72 flex-col rounded-card bg-bg-card p-3 shadow-card" data-testid={testId}>{children}</div>;
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 flex shrink-0 items-center justify-between gap-2">{children}</div>;
}

const SELECT_CLASS = 'shrink-0 rounded-btn border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary';

interface UsagePieDayCardProps {
  testId: string;
  datasets: PeriodDatasets;
  roleFilter: (entry: UsageRankingEntry) => boolean;
  emptyMessage: string;
}

// Chart-1 per row: a pie chart with its own embedded period picker, independent per card - the
// two rows' pie cards can each show a different period at the same time (e.g. Non-Admin showing
// Today while Admin/Admin-Master still shows Last 3 Days).
export function UsagePieDayCard({ testId, datasets, roleFilter, emptyMessage }: UsagePieDayCardProps) {
  const [period, setPeriod] = useState<PeriodOption>('last3Days');
  const { data, isLoading } = datasets[period];
  const filtered = data?.filter(roleFilter);

  return (
    <CardShell testId={testId}>
      <CardHeader>
        <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary">{PERIOD_LABELS[period]}</h3>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodOption)}
          aria-label="Select period"
          className={SELECT_CLASS}
        >
          {PERIOD_OPTIONS.map((value) => <option key={value} value={value}>{PERIOD_LABELS[value]}</option>)}
        </select>
      </CardHeader>
      <div className="min-h-0 flex-1">
        <UsagePieBody ranking={filtered} isLoading={isLoading} emptyMessage={emptyMessage} />
      </div>
    </CardShell>
  );
}

interface UsageMonthlyPieCardProps {
  testId: string;
  monthOptions: string[];
  roleFilter: (entry: UsageRankingEntry) => boolean;
  emptyMessage: string;
}

// Chart-2 per row: a pie chart with its own embedded month picker, independent per card - moved
// inside the card boundary rather than a page-level control shared across both rows.
export function UsageMonthlyPieCard({ testId, monthOptions, roleFilter, emptyMessage }: UsageMonthlyPieCardProps) {
  const [month, setMonth] = useState(currentMonth());
  const monthly = useUsageForMonth(month);
  const filtered = monthly.data?.ranking.filter(roleFilter);

  return (
    <CardShell testId={testId}>
      <CardHeader>
        <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary">{formatMonthLabel(month)}</h3>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Select month"
          className={SELECT_CLASS}
        >
          {monthOptions.map((m) => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
        </select>
      </CardHeader>
      <div className="min-h-0 flex-1">
        <UsagePieBody ranking={filtered} isLoading={monthly.isLoading} emptyMessage={emptyMessage} />
      </div>
    </CardShell>
  );
}

type BarSelection = PeriodOption | `month:${string}`;

function isMonthSelection(selection: BarSelection): selection is `month:${string}` {
  return selection.startsWith('month:');
}

interface UsageBarCardProps {
  testId: string;
  datasets: PeriodDatasets;
  monthOptions: string[];
  roleFilter: (entry: UsageRankingEntry) => boolean;
  emptyMessage: string;
}

// Chart-3 per row: a bar chart (by user, x-axis labels hidden - see UsageBarChart.tsx) with a
// single combined selector offering both the 4 day-based options and any available month,
// independent per card like the two pie cards above. When a day-based option is picked, this
// reads straight from the shared PeriodDatasets (no extra fetch); when a month is picked, it
// fetches that month itself via useUsageForMonth - always called regardless of the current
// selection (rules of hooks), which is cheap and gets deduped by React Query against any other
// card already viewing that same month.
export function UsageBarCard({ testId, datasets, monthOptions, roleFilter, emptyMessage }: UsageBarCardProps) {
  const [selection, setSelection] = useState<BarSelection>('last3Days');
  const monthMode = isMonthSelection(selection);
  const selectedMonth = monthMode ? selection.slice(6) : currentMonth();
  const monthQuery = useUsageForMonth(selectedMonth);

  const { data, isLoading } = monthMode
    ? { data: monthQuery.data?.ranking, isLoading: monthQuery.isLoading }
    : datasets[selection as PeriodOption];
  const filtered = data?.filter(roleFilter);
  const title = monthMode ? formatMonthLabel(selectedMonth) : PERIOD_LABELS[selection as PeriodOption];

  return (
    <CardShell testId={testId}>
      <CardHeader>
        <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary">{title}</h3>
        <select
          value={selection}
          onChange={(e) => setSelection(e.target.value as BarSelection)}
          aria-label="Select period or month"
          className={SELECT_CLASS}
        >
          <optgroup label="Recent">
            {PERIOD_OPTIONS.map((value) => <option key={value} value={value}>{PERIOD_LABELS[value]}</option>)}
          </optgroup>
          <optgroup label="Monthly">
            {monthOptions.map((m) => <option key={m} value={`month:${m}`}>{formatMonthLabel(m)}</option>)}
          </optgroup>
        </select>
      </CardHeader>
      <div className="min-h-0 flex-1">
        <UsageBarBody ranking={filtered} isLoading={isLoading} emptyMessage={emptyMessage} />
      </div>
    </CardShell>
  );
}
