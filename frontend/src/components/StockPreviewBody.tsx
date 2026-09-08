import '../lib/chartSetup';
import { Line } from 'react-chartjs-2';
import { useStockPreview } from '../api/stockPreview';
import { buildChartSeries, computeReturns, type PeriodReturns } from '../lib/stockPreview';
import { formatCurrency } from '../lib/format';

interface StockPreviewBodyProps {
  symbol: string;
}

const PILLS: { key: keyof PeriodReturns; label: string }[] = [
  { key: 'd90', label: '90D' },
  { key: 'd60', label: '60D' },
  { key: 'd30', label: '30D' },
  { key: 'd15', label: '15D' },
  { key: 'd10', label: '10D' },
  { key: 'd5', label: '5D' },
  { key: 'prev', label: 'Prev' },
];

function formatPill(v: number | null): string {
  if (v == null) return '—';
  const r = Math.round(v);
  return `${r >= 0 ? '+' : ''}${r}%`;
}

// Header + loading/error states + chart + pill row for a single symbol - no modal chrome of its
// own, so it can be reused both inside StockPreviewChart's popup (Dashboard/Flex/Momentum/
// Contrarian Finder/Long-Term Analysis/Contrarian Comeback's symbol-click preview) and inline
// inside a Stock Analysis quadrant.
export default function StockPreviewBody({ symbol }: StockPreviewBodyProps) {
  const { data, isLoading, isError } = useStockPreview(symbol);

  const quote = data?.quote;
  const historical = data?.historical ?? [];
  const marketOpen = quote?.isActivelyTrading === true;
  const currentPx = quote?.price ?? (historical[0] ? parseFloat(String(historical[0].close)) : 0);

  const hasEnoughData = historical.length >= 20 && currentPx > 0;
  const series = hasEnoughData ? buildChartSeries(historical, currentPx, marketOpen) : null;
  const returns = hasEnoughData ? computeReturns(historical, currentPx, marketOpen) : null;

  return (
    <div>
      <div className="mb-4">
        <p className="text-lg font-semibold text-text-primary">{symbol}{quote?.name ? ` · ${quote.name}` : ''}</p>
        {quote && (
          <p className={`text-sm ${quote.changePercent >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(quote.price)} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(1)}%)
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load preview data.</p>}
      {!isLoading && !isError && !hasEnoughData && (
        <p className="text-sm text-text-secondary">Not enough historical data for {symbol}.</p>
      )}

      {series && returns && (
        <>
          <div className="h-64">
            <Line
              data={{
                labels: series.labels,
                datasets: [
                  {
                    label: 'Price',
                    data: series.chartPrices,
                    borderColor: '#3b82f6',
                    backgroundColor: 'transparent',
                    pointRadius: 0,
                    tension: 0.2,
                    yAxisID: 'y',
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      title: (items) => series.rawDates[items[0]?.dataIndex ?? 0] ?? '',
                      label: (ctx) => ` Price: ${formatCurrency(Number(ctx.parsed.y))}`,
                    },
                  },
                },
                scales: {
                  y: { position: 'left' },
                },
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PILLS.map(({ key, label }) => (
              <span
                key={key}
                className={`rounded-btn px-2 py-1 text-xs font-semibold ${
                  (returns[key] ?? 0) >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {label} {formatPill(returns[key])}
              </span>
            ))}
            <span
              className={`rounded-btn px-2 py-1 text-xs font-semibold ${
                (returns.today ?? 0) >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
              }`}
            >
              {marketOpen ? 'O' : 'C'} {formatPill(returns.today)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
