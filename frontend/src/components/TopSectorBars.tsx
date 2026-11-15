import '../lib/chartSetup';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { fmtDollarTick } from '../lib/sectorBars';

export interface SectorBarSeries {
  label: string;
  // One colour for the whole series, or one per bar.
  color: string | string[];
  data: (number | null)[];
}

export interface SectorBarChart {
  sector: string;
  labels: string[];
  series: SectorBarSeries[];
  // Sector total shown in brackets after the name, e.g. "Technology ($168.3K)". Green/red for a
  // signed Performance figure, neutral for a plain value total.
  headerValue?: { text: string; tone: 'gain' | 'loss' | 'neutral' };
}

const TONE_CLASS = { gain: 'text-success', loss: 'text-danger', neutral: 'text-text-secondary' } as const;

// Caps bar thickness so a sector with one ticker doesn't render as one fat bar. Grouped
// (multi-series) charts get thinner bars so their series still fit side by side.
const MAX_BAR_THICKNESS_SINGLE = 22;
const MAX_BAR_THICKNESS_GROUPED = 9;

interface TopSectorBarsProps {
  charts: SectorBarChart[];
  format: 'dollar' | 'percent';
}

// Horizontal bars: tickers down the Y axis, value along the X axis. Tick/tooltip text is kept
// small (9px) so six charts fit inside a half-width dashboard card.
function buildOptions(format: 'dollar' | 'percent'): ChartOptions<'bar'> {
  return {
    indexAxis: 'y',
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const raw = Number(ctx.raw);
            const formatted = format === 'dollar'
              ? `${raw < 0 ? '-' : ''}$${Math.abs(raw).toFixed(2)}`
              : `${raw.toFixed(2)}%`;
            return ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${formatted}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          font: { size: 9 },
          callback: (v) => (format === 'dollar' ? fmtDollarTick(Number(v)) : `${v}%`),
        },
      },
      y: { ticks: { font: { size: 9 } } },
    },
  };
}

// Grid of one bar chart per sector: 3 across, 2 rows. Each cell takes an equal share of
// whatever height its parent gives this component (the parent must be a fixed height).
export default function TopSectorBars({ charts, format }: TopSectorBarsProps) {
  const options = buildOptions(format);
  return (
    <div className="grid h-full min-h-0 grid-cols-3 grid-rows-2 gap-2">
      {charts.map((c) => (
        <div key={c.sector} className="flex min-h-0 min-w-0 flex-col">
          <p
            className="mb-0.5 shrink-0 truncate text-center text-[10px] font-semibold text-text-primary"
            title={c.headerValue ? `${c.sector} (${c.headerValue.text})` : c.sector}
          >
            {c.sector}
            {c.headerValue && (
              <span className={`ml-1 ${TONE_CLASS[c.headerValue.tone]}`} data-testid="sector-header-value">
                ({c.headerValue.text})
              </span>
            )}
          </p>
          <div className="relative min-h-0 flex-1">
            <Bar
              data={{
                labels: c.labels,
                datasets: c.series.map((s) => ({
                  label: s.label,
                  data: s.data,
                  backgroundColor: s.color,
                  maxBarThickness: c.series.length > 1 ? MAX_BAR_THICKNESS_GROUPED : MAX_BAR_THICKNESS_SINGLE,
                })),
              }}
              options={options}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
