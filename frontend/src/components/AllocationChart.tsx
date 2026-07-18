import '../lib/chartSetup';
import { Pie } from 'react-chartjs-2';
import type { PortfolioHolding } from '../api/portfolios';

interface AllocationChartProps {
  holdings: PortfolioHolding[];
}

const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#64748b'];

// By sector (falls back to the holding's own symbol when sector is unknown,
// matching the source app's allocation-pie behavior for unmapped tickers).
export default function AllocationChart({ holdings }: AllocationChartProps) {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const key = h.sector || h.symbol;
    bySector.set(key, (bySector.get(key) ?? 0) + h.currentValue);
  }
  const labels = [...bySector.keys()];
  const data = [...bySector.values()];

  if (labels.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings to chart yet.</p>;
  }

  return (
    <Pie
      data={{
        labels,
        datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]) }],
      }}
      options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
    />
  );
}
