import { useState } from 'react';
import { Chart } from 'react-chartjs-2';
import '../lib/chartSetup';
import {
  useCandlestickSnapshot, useRefreshCandlestick,
  CANDLESTICK_INTERVALS, type CandlestickInterval, type CandlestickIndicators,
} from '../api/candlestick';
import { formatAsOf } from '../lib/format';

const INTERVAL_LABELS: Record<CandlestickInterval, string> = {
  '5min': '5 Min', '15min': '15 Min', '30min': '30 Min', '1hour': '1 Hour', '4hour': '4 Hour', '1day': '1 Day',
};

// Every one of these overlays/panels is pure math already sitting in the fetched snapshot - no
// network call, so toggling any of them on/off is instant. Defaulted all-off (empty Set below) to
// keep the chart readable on first open, per the "too many overlays gets visually difficult"
// discussion. RSI/MACD are oscillators (a different value scale than price) so they render as
// their own stacked panel below, never overlaid on the candlesticks - everything else overlays
// directly.
type IndicatorKey = 'ma' | 'bb' | 'vwap' | 'pivotPoints' | 'fibonacci' | 'rsi' | 'macd';
const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  ma: 'Moving Averages', bb: 'Bollinger Bands', vwap: 'VWAP', pivotPoints: 'Pivot Points', fibonacci: 'Fibonacci', rsi: 'RSI', macd: 'MACD',
};

interface CandlestickPopupProps {
  symbol: string;
  initialInterval: CandlestickInterval;
  onClose: () => void;
}

export default function CandlestickPopup({ symbol, initialInterval, onClose }: CandlestickPopupProps) {
  const [interval, setInterval] = useState<CandlestickInterval>(initialInterval);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());
  const { data: snapshot, isLoading } = useCandlestickSnapshot(symbol, interval);
  const refresh = useRefreshCandlestick();

  function toggleIndicator(key: IndicatorKey) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleFetch() {
    refresh.mutate({ symbol, interval });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary" data-testid="candlestick-popup">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-secondary px-4 py-3">
        <h1 className="text-lg font-semibold text-text-primary">{symbol}</h1>
        <div className="flex flex-wrap gap-1" data-testid="candlestick-interval-selector">
          {CANDLESTICK_INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              data-testid={`candlestick-interval-${iv}`}
              className={`rounded-btn px-2.5 py-1 text-sm font-medium transition-colors ${
                interval === iv ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
              }`}
            >
              {INTERVAL_LABELS[iv]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="candlestick-popup-close"
          className="ml-auto rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
        >
          Close
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

        {!isLoading && !snapshot && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" data-testid="candlestick-confirm-fetch">
            <p className="text-sm text-text-secondary">
              No cached data for {symbol} at {INTERVAL_LABELS[interval]} yet.
            </p>
            {refresh.isError && <p className="text-sm text-danger">{(refresh.error as Error)?.message}</p>}
            <button
              type="button"
              onClick={handleFetch}
              disabled={refresh.isPending}
              data-testid="candlestick-confirm-fetch-button"
              className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {refresh.isPending ? 'Fetching…' : 'Fetch fresh data (uses 1 of your limit)'}
            </button>
          </div>
        )}

        {!isLoading && snapshot && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span
                data-testid="candlestick-freshness-badge"
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  snapshot.isFresh ? 'bg-success/10 text-success' : 'bg-border text-text-secondary'
                }`}
              >
                {snapshot.isFresh ? 'Fresh' : 'Stale'}
              </span>
              <span className="text-xs text-text-secondary" data-testid="candlestick-time-of-pull">
                Pulled {formatAsOf(snapshot.updatedAt)}
              </span>
              {!snapshot.isFresh && (
                <button
                  type="button"
                  onClick={handleFetch}
                  disabled={refresh.isPending}
                  data-testid="candlestick-refresh-button"
                  className="text-xs text-accent hover:underline disabled:opacity-60"
                >
                  {refresh.isPending ? 'Refreshing…' : 'Refresh (uses 1 of your limit)'}
                </button>
              )}
              {refresh.isError && <p className="text-xs text-danger">{(refresh.error as Error)?.message}</p>}
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5" data-testid="candlestick-indicator-toggles">
              {(Object.keys(INDICATOR_LABELS) as IndicatorKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleIndicator(key)}
                  data-testid={`candlestick-toggle-${key}`}
                  aria-pressed={activeIndicators.has(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeIndicators.has(key)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:bg-bg-card'
                  }`}
                >
                  {INDICATOR_LABELS[key]}
                </button>
              ))}
            </div>

            <PriceChart bars={snapshot.bars} indicators={snapshot.indicators} activeIndicators={activeIndicators} />
            <VolumeChart bars={snapshot.bars} />
            {activeIndicators.has('rsi') && <RsiChart bars={snapshot.bars} rsi14={snapshot.indicators.rsi14} />}
            {activeIndicators.has('macd') && <MacdChart bars={snapshot.bars} macd={snapshot.indicators.macd} />}
          </>
        )}
      </div>
    </div>
  );
}

interface ChartBars {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Reverses newest-first API bars into chronological (oldest-first) order, matching how a
// left-to-right axis needs to read.
function toChronological(bars: ChartBars[]): ChartBars[] {
  return [...bars].reverse();
}

// Phase 1.1 - bars are positioned by their plain sequence INDEX (0, 1, 2...), not by real
// elapsed time, so weekend/overnight gaps between trading sessions no longer draw to scale and
// squash each session's real price action into a narrow sliver (verified live: this was
// flattening moving-average overlays into a misleading staircase). Every dataset across all four
// stacked panels shares this same index positioning to stay visually aligned. The real date is
// recovered for tick labels/tooltips by looking up the index in `chronological` (see
// makeIndexAxisTicks/makeTooltipTitleCallback below).
function formatTickLabel(dateStr: string): string {
  const hasTime = dateStr.includes(' ');
  const d = new Date(dateStr.replace(' ', 'T'));
  return hasTime
    ? d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own tick callback signature, kept loose like the rest of this file's chart options
function makeIndexAxisTicks(chronological: ChartBars[], display: boolean): any {
  return {
    display,
    autoSkip: true,
    maxRotation: 0,
    maxTicksLimit: 8,
    callback: (value: string | number) => {
      const bar = chronological[Math.round(Number(value))];
      return bar ? formatTickLabel(bar.date) : '';
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own tooltip item shape, kept loose like the rest of this file's chart options
function makeTooltipTitleCallback(chronological: ChartBars[]) {
  return (items: any[]): string => {
    const item = items[0];
    const idx = Math.round(item?.parsed?.x ?? item?.dataIndex ?? 0);
    const bar = chronological[idx];
    return bar ? formatTickLabel(bar.date) : '';
  };
}

// Series-shaped indicator values are newest-first (same convention as `bars`, same length) with
// `null` where there isn't enough trailing history yet. Reverses to chronological order (index i
// = the i-th chronological bar) and drops nulls so Chart.js gets a clean, gapless line. Takes
// only the series, not `bars` - a real pairing bug found while making this change: the previous
// version reversed the series but zipped it against the ORIGINAL (still newest-first) `bars`
// array by the same index, silently mismatching every point's x/y except the exact midpoint
// (bars[0] - the newest bar - was paired with chronological[0] - the OLDEST series value, and so
// on). Both sides need the same ordering to line up; using the series' own length for indices
// removes the second array entirely rather than needing to keep two arrays in sync.
function seriesToPoints(series: (number | null)[] | null | undefined): { x: number; y: number }[] {
  if (!series) return [];
  return [...series].reverse()
    .map((y, i) => ({ x: i, y }))
    .filter((p): p is { x: number; y: number } => p.y != null);
}

function flatLine(chronologicalLength: number, value: number): { x: number; y: number }[] {
  if (chronologicalLength === 0) return [];
  return [{ x: 0, y: value }, { x: chronologicalLength - 1, y: value }];
}

const OVERLAY_COLORS = {
  sma20: '#3b82f6', sma50: '#f59e0b', ema20: '#a855f7', bbBand: '#94a3b8', bbMid: '#64748b',
  vwap: '#14b8a6', pivot: '#ef4444', fib: '#eab308',
};

function PriceChart({ bars, indicators, activeIndicators }: {
  bars: ChartBars[]; indicators: CandlestickIndicators; activeIndicators: Set<IndicatorKey>;
}) {
  const chronological = toChronological(bars);
  const candleData = chronological.map((b, i) => ({ x: i, o: b.open, h: b.high, l: b.low, c: b.close }));

  // chartjs-chart-financial's dataset shape isn't fully compatible with react-chartjs-2's own
  // mixed-dataset typing (Chart<"candlestick"> only accepts FinancialDataPoint[] datasets, not
  // the line/bar overlays mixed in below) - same untyped-array escape hatch every Chart.js
  // consumer mixing dataset types needs; its own README examples do the same.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  const datasets: any[] = [
    { label: 'Price', data: candleData, borderColor: '#16a34a', color: { up: '#16a34a', down: '#dc2626', unchanged: '#94a3b8' } },
  ];

  if (activeIndicators.has('ma')) {
    datasets.push({ type: 'line', label: 'SMA 20', data: seriesToPoints(indicators.sma20), borderColor: OVERLAY_COLORS.sma20, borderWidth: 1.5, pointRadius: 0 });
    datasets.push({ type: 'line', label: 'SMA 50', data: seriesToPoints(indicators.sma50), borderColor: OVERLAY_COLORS.sma50, borderWidth: 1.5, pointRadius: 0 });
    if (indicators.ema20) datasets.push({ type: 'line', label: 'EMA 20', data: seriesToPoints(indicators.ema20), borderColor: OVERLAY_COLORS.ema20, borderWidth: 1.5, pointRadius: 0 });
  }
  if (activeIndicators.has('bb')) {
    const upper = indicators.bb20.map((v) => (v ? v.upper : null));
    const mid = indicators.bb20.map((v) => (v ? v.mid : null));
    const lower = indicators.bb20.map((v) => (v ? v.lower : null));
    datasets.push({ type: 'line', label: 'BB Upper', data: seriesToPoints(upper), borderColor: OVERLAY_COLORS.bbBand, borderWidth: 1, pointRadius: 0, borderDash: [4, 3] });
    datasets.push({ type: 'line', label: 'BB Mid', data: seriesToPoints(mid), borderColor: OVERLAY_COLORS.bbMid, borderWidth: 1, pointRadius: 0 });
    datasets.push({ type: 'line', label: 'BB Lower', data: seriesToPoints(lower), borderColor: OVERLAY_COLORS.bbBand, borderWidth: 1, pointRadius: 0, borderDash: [4, 3] });
  }
  if (activeIndicators.has('vwap')) {
    datasets.push({ type: 'line', label: 'VWAP', data: seriesToPoints(indicators.vwap), borderColor: OVERLAY_COLORS.vwap, borderWidth: 1.5, pointRadius: 0 });
  }
  if (activeIndicators.has('pivotPoints') && indicators.pivotPoints) {
    const pp = indicators.pivotPoints;
    (['pp', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const).forEach((key) => {
      datasets.push({ type: 'line', label: `Pivot ${key.toUpperCase()}`, data: flatLine(chronological.length, pp[key]), borderColor: OVERLAY_COLORS.pivot, borderWidth: key === 'pp' ? 1.5 : 1, pointRadius: 0, borderDash: key === 'pp' ? [] : [2, 3] });
    });
  }
  if (activeIndicators.has('fibonacci') && indicators.fibonacci) {
    indicators.fibonacci.levels.forEach((level) => {
      datasets.push({ type: 'line', label: `Fib ${(level.pct * 100).toFixed(1)}%`, data: flatLine(chronological.length, level.price), borderColor: OVERLAY_COLORS.fib, borderWidth: 1, pointRadius: 0, borderDash: [3, 2] });
    });
  }

  return (
    <div className="mb-3 h-96" data-testid="candlestick-price-chart">
      <Chart
        type="candlestick"
        data={{ datasets }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ticks: makeIndexAxisTicks(chronological, true) }, y: { position: 'right' } },
          plugins: {
            legend: { display: activeIndicators.size > 0, labels: { boxHeight: 6 } },
            tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } },
          },
        }}
      />
    </div>
  );
}

// Compact K/M formatting for volume's y-axis - "4,000,000" is much harder to scan at a glance
// than "4M". Strips a trailing ".0" so round numbers ("2M", not "2.0M") stay clean.
function formatVolumeTick(tickValue: string | number): string {
  const value = Number(tickValue);
  const abs = Math.abs(value);
  const withSuffix = (divisor: number, suffix: string) => {
    const rounded = (value / divisor).toFixed(1);
    return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}${suffix}`;
  };
  if (abs >= 1_000_000) return withSuffix(1_000_000, 'M');
  if (abs >= 1_000) return withSuffix(1_000, 'K');
  return String(value);
}

function VolumeChart({ bars }: { bars: ChartBars[] }) {
  const chronological = toChronological(bars);
  const data = chronological.map((b, i) => ({
    x: i, y: b.volume,
    backgroundColor: b.close >= b.open ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)',
  }));
  return (
    <div className="mb-3 h-24" data-testid="candlestick-volume-chart">
      <Chart
        type="bar"
        data={{ datasets: [{ label: 'Volume', data }] }}
        options={{
          maintainAspectRatio: false,
          // No x tick labels here - the price chart directly above is this stack's one shared
          // axis (same convention as any candlestick+volume charting platform); giving
          // Volume/RSI/MACD's own independent Chart.js instance its own tick-selection pass
          // produced a real, live-found bug: inconsistent, out-of-order labels that didn't even
          // agree with the price chart's own, despite covering identical bars. The tooltip title
          // still resolves the real date on hover even though the axis itself stays unlabeled.
          scales: { x: { type: 'linear', ticks: makeIndexAxisTicks(chronological, false) }, y: { position: 'right', ticks: { callback: formatVolumeTick } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } } },
        }}
      />
    </div>
  );
}

function RsiChart({ bars, rsi14 }: { bars: ChartBars[]; rsi14: (number | null)[] | null }) {
  const chronological = toChronological(bars);
  return (
    <div className="mb-3 h-32" data-testid="candlestick-rsi-chart">
      <Chart
        type="line"
        data={{ datasets: [{ label: 'RSI (14)', data: seriesToPoints(rsi14), borderColor: '#8b5cf6', borderWidth: 1.5, pointRadius: 0 }] }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ticks: makeIndexAxisTicks(chronological, false) }, y: { position: 'right', min: 0, max: 100 } },
          plugins: { legend: { display: true, labels: { boxHeight: 6 } }, tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } } },
        }}
      />
    </div>
  );
}

function MacdChart({ bars, macd }: { bars: ChartBars[]; macd: ({ macd: number; signal: number; hist: number } | null)[] | null }) {
  const chronological = toChronological(bars);
  const macdLine = seriesToPoints(macd?.map((v) => (v ? v.macd : null)) ?? null);
  const signalLine = seriesToPoints(macd?.map((v) => (v ? v.signal : null)) ?? null);
  const histData = macd
    ? [...macd].reverse().map((v, i) => (v ? { x: i, y: v.hist, backgroundColor: v.hist >= 0 ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)' } : null)).filter((p): p is { x: number; y: number; backgroundColor: string } => p != null)
    : [];

  return (
    <div className="mb-3 h-32" data-testid="candlestick-macd-chart">
      <Chart
        type="bar"
        data={{
          datasets: [
            { type: 'bar', label: 'Histogram', data: histData },
            { type: 'line', label: 'MACD', data: macdLine, borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0 },
            { type: 'line', label: 'Signal', data: signalLine, borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0 },
          ],
        }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ticks: makeIndexAxisTicks(chronological, false) }, y: { position: 'right' } },
          plugins: { legend: { display: true, labels: { boxHeight: 6 } }, tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } } },
        }}
      />
    </div>
  );
}
