import '../lib/chartSetup';
import { useRef } from 'react';
import { Pie } from 'react-chartjs-2';
import type { UsageRankingEntry } from '../api/usageAudit';
import { usageSharesFromRanking, USAGE_PALETTE } from '../lib/usageShare';

interface TooltipContext {
  label?: string;
  parsed: number;
}

interface UsagePieBodyProps {
  ranking: UsageRankingEntry[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
}

// User Usage Dashboard sub-tab - one slice per user. Body-only (no card chrome/title): the
// Dashboard's per-card wrappers (UsageDashboardCards.tsx) own the heading and the embedded
// period/month control, since each card now picks its own time window independently.
export default function UsagePieBody({ ranking, isLoading, emptyMessage }: UsagePieBodyProps) {
  // jsdom (no `canvas` package) crashes on an in-place Chart.js update when this component
  // re-renders with a new `ranking` reference (e.g. after switching a card's own control) -
  // same fix AllocationChart.tsx already established: force a remount via a changing `key`
  // whenever the prop reference itself changes, rather than letting react-chartjs-2 try to
  // update the existing chart instance.
  const rankingRef = useRef(ranking);
  const remountTick = useRef(0);
  if (rankingRef.current !== ranking) {
    rankingRef.current = ranking;
    remountTick.current += 1;
  }

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading…</p>;
  }

  const shares = usageSharesFromRanking(ranking);

  if (shares.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyMessage}</p>;
  }

  const labels = shares.map((entry) => entry.email);
  const data = shares.map((entry) => entry.calls);
  const colors = labels.map((_, i) => USAGE_PALETTE[i % USAGE_PALETTE.length]);
  const total = data.reduce((sum, v) => sum + v, 0);

  const options = {
    maintainAspectRatio: false,
    layout: { padding: 8 },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipContext) => {
            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0';
            return `${ctx.label}: ${ctx.parsed} calls (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="flex h-full min-w-0 flex-col items-stretch gap-2 sm:flex-row">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="aspect-square h-full max-w-full">
          <Pie key={`usage-pie-${remountTick.current}`} data={{ labels, datasets: [{ data, backgroundColor: colors }] }} options={options} />
        </div>
      </div>
      <div className="grid min-h-0 max-h-full w-full shrink-0 auto-rows-min grid-cols-1 gap-y-1 overflow-y-auto sm:w-32">
        {labels.map((label, i) => (
          <span key={label} className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i] }} />
            <span className="truncate" title={label}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
