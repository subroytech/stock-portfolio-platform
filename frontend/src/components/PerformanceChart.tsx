import '../lib/chartSetup';
import { Bar } from 'react-chartjs-2';
import type { PortfolioHolding } from '../api/portfolios';

interface PerformanceChartProps {
  holdings: PortfolioHolding[];
}

// Per-holding gain/loss bar chart. The backend has no historical
// portfolio-value snapshots (only the current live state), so unlike the
// source app's multi-day performance view, this shows what's actually
// derivable today: each holding's total $ gain/loss since purchase.
export default function PerformanceChart({ holdings }: PerformanceChartProps) {
  const sorted = [...holdings].sort((a, b) => b.gainLoss - a.gainLoss);

  if (sorted.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings to chart yet.</p>;
  }

  return (
    <Bar
      data={{
        labels: sorted.map((h) => h.symbol),
        datasets: [{
          label: 'Gain / Loss ($)',
          data: sorted.map((h) => h.gainLoss),
          backgroundColor: sorted.map((h) => (h.gainLoss >= 0 ? '#22c55e' : '#ef4444')),
        }],
      }}
      options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
    />
  );
}
