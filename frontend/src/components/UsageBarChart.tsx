import '../lib/chartSetup';
import { useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import type { UsageRankingEntry } from '../api/usageAudit';
import { usageSharesByFeature, USAGE_PALETTE } from '../lib/usageShare';

interface TooltipContext {
  label?: string;
  parsed: { y: number | null };
}

interface UsageBarBodyProps {
  ranking: UsageRankingEntry[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
}

// User Usage Dashboard sub-tab - one bar per function/feature (Stock Preview, Contrarian
// Finder, Momentum Analysis, etc.), summed across every user in the role-filtered ranking slice
// passed in - unlike the sibling pie charts, which stay per-user. Same hidden-x-axis-ticks +
// wrapped-legend-below pattern as before this was per-feature (kept for consistency, and to
// avoid showing every label twice on a small card) - x-axis identification comes from the
// tooltip (hover) plus the legend, not from tick labels.
export default function UsageBarBody({ ranking, isLoading, emptyMessage }: UsageBarBodyProps) {
  // Same jsdom in-place-update crash workaround as UsagePieChart.tsx/AllocationChart.tsx.
  const rankingRef = useRef(ranking);
  const remountTick = useRef(0);
  if (rankingRef.current !== ranking) {
    rankingRef.current = ranking;
    remountTick.current += 1;
  }

  if (isLoading) {
    return <p className="text-sm text-text-secondary">Loading…</p>;
  }

  const shares = usageSharesByFeature(ranking);

  if (shares.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyMessage}</p>;
  }

  const labels = shares.map((entry) => entry.label);
  const data = shares.map((entry) => entry.calls);
  const colors = labels.map((_, i) => USAGE_PALETTE[i % USAGE_PALETTE.length]);
  const total = data.reduce((sum, v) => sum + v, 0);

  const options = {
    maintainAspectRatio: false,
    layout: { padding: 8 },
    scales: {
      x: { ticks: { display: false }, grid: { display: false } },
      y: { beginAtZero: true },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipContext) => {
            const value = ctx.parsed.y ?? 0;
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return `${ctx.label}: ${value} calls (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        <Bar
          key={`usage-bar-${remountTick.current}`}
          data={{ labels, datasets: [{ data, backgroundColor: colors }] }}
          options={options}
        />
      </div>
      <div className="flex max-h-16 shrink-0 flex-wrap justify-center gap-x-2 gap-y-1 overflow-y-auto">
        {labels.map((label, i) => (
          <span key={label} className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i] }} />
            <span className="max-w-[11rem] truncate" title={label}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
