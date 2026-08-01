import '../lib/chartSetup';
import { memo, useRef } from 'react';
import { Pie } from 'react-chartjs-2';
import type { PortfolioHolding } from '../api/portfolios';
import { formatAsOf, formatWholeCurrency } from '../lib/format';

export type AllocationMode = 'sector' | 'stock' | 'todayDollar';

interface AllocationChartProps {
  holdings: PortfolioHolding[];
  mode: AllocationMode;
}

// Bright floral palette (vivid azalea pink, iris purple, leaf green, marigold
// orange, tulip teal, sunflower yellow, poppy red, morning-glory blue,
// orchid magenta) - saturated and vibrant, not dusty/muted.
const PALETTE = ['#FF4FA0', '#7ED957', '#9B5DE5', '#FF8C42', '#00C2CB', '#FFCA3A', '#FF3B5C', '#3DA9FC', '#D6336C'];

// Caps a labeled value list at 19 entries + an aggregated "Other" slice -
// ported from the source app's legend cap (kept simple here by truncating
// the dataset itself, rather than the source's generateLabels-only legend
// override - functionally equivalent, fewer raw Chart.js internals to lean on).
function capAt19(labels: string[], data: number[]): { labels: string[]; data: number[] } {
  if (labels.length <= 19) return { labels, data };
  const entries = labels.map((label, i) => ({ label, value: data[i] })).sort((a, b) => b.value - a.value);
  const top = entries.slice(0, 19);
  const otherTotal = entries.slice(19).reduce((sum, e) => sum + e.value, 0);
  return { labels: [...top.map((e) => e.label), 'Other'], data: [...top.map((e) => e.value), otherTotal] };
}

const PIE_OPTIONS = {
  maintainAspectRatio: false,
  layout: { padding: 16 },
  plugins: {
    legend: { display: false },
  },
};

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-btn px-2 py-1 text-xs font-medium transition-colors ${active ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-border'}`}
    >
      {label}
    </button>
  );
}

// Rendered by DashboardPage in the "Allocation" card's own header row
// (alongside the heading) rather than inside AllocationChart itself, so the
// toggle and the heading share one line instead of the toggle eating a row
// of vertical space above the chart.
export function AllocationModeToggle({ mode, onChange }: { mode: AllocationMode; onChange: (mode: AllocationMode) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Pill label="Today's $" active={mode === 'todayDollar'} onClick={() => onChange('todayDollar')} />
      <Pill label="By Stock" active={mode === 'stock'} onClick={() => onChange('stock')} />
      <Pill label="By Sector" active={mode === 'sector'} onClick={() => onChange('sector')} />
    </div>
  );
}

// Fills whatever height its flex-column ancestor gives it and centers a
// square pie inside - maximizes the pie's size against WHICHEVER dimension
// (available height or available width) is the tighter constraint, instead
// of a hand-picked fixed pixel size per mode. `min-h-0` is required on both
// this and its flex-column ancestors: without it, a flex item's default
// min-height:auto refuses to shrink below its content size, which breaks
// "fill the remaining space after the sibling headers/legends" math.
function PieBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="aspect-square h-full max-w-full">{children}</div>
    </div>
  );
}

// Chip list to the right of the pie. By Sector uses a single column (few,
// long sector names); By Stock can have up to 20 tickers (19 + "Other"), so
// it uses up to 2 columns to stay compact within the same fixed height
// rather than needing a much taller single column.
function SideLegend({ labels, colors, columns = 1 }: { labels: string[]; colors: string[]; columns?: 1 | 2 }) {
  return (
    <div
      className={`grid min-w-0 max-h-full shrink-0 auto-rows-min gap-y-1 overflow-y-auto sm:pl-2 ${
        // Narrower + tighter column gap below sm - the fixed w-64/gap-x-3
        // was wider than a phone screen has room for once the pie next to
        // it (also fighting for width) is accounted for, so the 2nd column
        // was getting clipped instead of just wrapping smaller.
        columns === 2 ? 'w-full grid-cols-2 gap-x-2 sm:w-56' : 'w-full grid-cols-1 sm:w-36'
      }`}
    >
      {labels.map((label, i) => (
        <span key={label} className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i] }} />
          <span className="truncate" title={label}>{label}</span>
        </span>
      ))}
    </div>
  );
}

// Wrapping chip row below the pie - used for Today's $, where each side
// (Gainers/Losers) already only shows up to 10 short ticker symbols, so a
// couple of wrapped rows underneath stays compact even in a half-width column.
function BottomLegend({ labels, colors }: { labels: string[]; colors: string[] }) {
  return (
    <div className="mt-2 flex max-w-full shrink-0 flex-wrap justify-center gap-x-2 gap-y-1">
      {labels.map((label, i) => (
        <span key={label} className="flex items-center gap-1 text-xs text-text-secondary">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// Oldest priceUpdatedAt across whichever holdings actually contributed a
// today_change value - same "don't overclaim freshness" principle as
// DashboardPage's portfolio-wide staleness banner, but scoped to just the
// holdings this specific view is built from.
function oldestAsOf(holdings: { priceUpdatedAt: string | null }[]): string | null {
  return holdings.map((h) => h.priceUpdatedAt).filter((t): t is string => t != null).sort()[0] ?? null;
}

// By Sector (falls back to the holding's own symbol when sector is unknown)
// / By Stock (one slice per holding) / Today's $ (dual pie: Gainers vs.
// Losers, sized by today's $ change) - ported from the source app's
// Allocation widget modes. Today's $ reads todayChangeDollar straight off
// `holdings` - it's DB-persisted (tx_holdings.today_change_dollar, migration
// 014) alongside priceUpdatedAt, so it's available immediately on load/
// portfolio switch, not gated on a Refresh Prices click this session.
// Controlled by `mode` (owned by DashboardPage, driven by AllocationModeToggle
// above) rather than its own internal state, so the toggle can live in the
// card's header row instead of inside this component.
// DashboardPage gives this component a FIXED height (not a variable
// min-height) - all three modes fill that same height via PieBox, so the
// card's vertical size no longer changes when switching modes.
// Wrapped in React.memo: `holdings` keeps the same array reference across
// parent re-renders that don't actually change it (e.g. DashboardPage
// re-rendering because refreshResult changed, which only PerformanceChart
// cares about) - without this, an unrelated parent re-render still reaches
// react-chartjs-2 with a brand-new `data` object literal, which drives an
// in-place Chart.js update instead of a fresh mount and crashes under jsdom
// (no `canvas` package). Memoizing skips the re-render entirely when
// `holdings`/`mode` are unchanged, which is also just less wasted work in production.
function AllocationChart({ holdings, mode }: AllocationChartProps) {
  // jsdom (no `canvas` package) crashes on an in-place Chart.js update when
  // this component re-renders with a new `holdings` reference but the same
  // `mode` (e.g. after a refresh) - forcing a remount whenever the prop
  // reference itself changes sidesteps it reliably (unlike keying off
  // derived values, which can coincidentally stay the same across a refresh
  // in tests). Mutating a ref during render is intentional here - it's the
  // standard "derive state from changed props" escape hatch, and doesn't
  // itself trigger a re-render.
  const holdingsRef = useRef(holdings);
  const remountTick = useRef(0);
  if (holdingsRef.current !== holdings) {
    holdingsRef.current = holdings;
    remountTick.current += 1;
  }

  if (holdings.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings to chart yet.</p>;
  }

  if (mode === 'todayDollar') {
    const withChange = holdings
      .map((h) => ({ symbol: h.symbol, change: h.todayChangeDollar }))
      .filter((h): h is { symbol: string; change: number } => h.change != null);

    if (withChange.length === 0) {
      return <p className="text-sm text-text-secondary">No today&rsquo;s $ data yet — click Refresh Prices above.</p>;
    }

    const asOf = oldestAsOf(holdings.filter((h) => h.todayChangeDollar != null));
    const gainers = withChange.filter((h) => h.change >= 0).sort((a, b) => b.change - a.change);
    const losers = withChange.filter((h) => h.change < 0).sort((a, b) => a.change - b.change);
    // Totals reflect ALL gainers/losers - only the pie+legend below are
    // capped to the top 10 by magnitude, so the header $ figure stays
    // accurate even when a portfolio has more movers than fit on the chart.
    const gainersTotal = gainers.reduce((sum, g) => sum + g.change, 0);
    const losersTotal = losers.reduce((sum, l) => sum + l.change, 0);
    const gTop = gainers.slice(0, 10);
    const lTop = losers.slice(0, 10);
    const gLabels = gTop.map((g) => g.symbol);
    const gData = gTop.map((g) => g.change);
    const lLabels = lTop.map((l) => l.symbol);
    const lData = lTop.map((l) => Math.abs(l.change));
    const gColors = gLabels.map((_, i) => PALETTE[i % PALETTE.length]);
    const lColors = lLabels.map((_, i) => PALETTE[i % PALETTE.length]);

    return (
      <div className="flex h-full flex-col">
        {asOf && <p className="mb-1 shrink-0 text-center text-xs text-text-muted">As of {formatAsOf(asOf)}</p>}
        {/* grid-cols-1 below sm: forcing 2 columns on a narrow phone left
            no room for either pie's height-driven width to shrink into
            (grid items default to min-width:auto, refusing to shrink below
            content size), so the two pies overlapped instead of fitting
            side by side. min-w-0 is extra insurance at the sm boundary. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-h-0 min-w-0 flex-col items-center">
            <p className="mb-1 shrink-0 text-center text-xs font-medium text-success">Gainers · {formatWholeCurrency(gainersTotal)}</p>
            {gLabels.length > 0 ? (
              <>
                <PieBox>
                  <Pie
                    key={`gainers-${remountTick.current}`}
                    data={{ labels: gLabels, datasets: [{ data: gData, backgroundColor: gColors }] }}
                    options={PIE_OPTIONS}
                  />
                </PieBox>
                <BottomLegend labels={gLabels} colors={gColors} />
              </>
            ) : <p className="text-center text-xs text-text-muted">None</p>}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col items-center">
            <p className="mb-1 shrink-0 text-center text-xs font-medium text-danger">Losers · {formatWholeCurrency(losersTotal)}</p>
            {lLabels.length > 0 ? (
              <>
                <PieBox>
                  <Pie
                    key={`losers-${remountTick.current}`}
                    data={{ labels: lLabels, datasets: [{ data: lData, backgroundColor: lColors }] }}
                    options={PIE_OPTIONS}
                  />
                </PieBox>
                <BottomLegend labels={lLabels} colors={lColors} />
              </>
            ) : <p className="text-center text-xs text-text-muted">None</p>}
          </div>
        </div>
      </div>
    );
  }

  const grouped = new Map<string, number>();
  for (const h of holdings) {
    const key = mode === 'sector' ? (h.sector || h.symbol) : h.symbol;
    grouped.set(key, (grouped.get(key) ?? 0) + h.currentValue);
  }
  const { labels, data } = capAt19([...grouped.keys()], [...grouped.values()]);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  // By Sector and By Stock share the same pie+side-legend layout - By Stock
  // just gets a 2-column legend since it can have up to 20 entries (19 +
  // "Other") versus Sector's usually-few sectors. Stacked (pie above,
  // legend below) below sm, side by side (legend to the right) from sm up -
  // a phone-width row has no room for a real legend column next to a pie
  // that also needs to shrink, so both compete and the legend loses.
  return (
    <div className="flex h-full min-w-0 flex-col items-stretch gap-2 sm:flex-row">
      <PieBox>
        <Pie
          key={`${mode}-${remountTick.current}`}
          data={{ labels, datasets: [{ data, backgroundColor: colors }] }}
          options={PIE_OPTIONS}
        />
      </PieBox>
      <SideLegend labels={labels} colors={colors} columns={mode === 'stock' ? 2 : 1} />
    </div>
  );
}

export default memo(AllocationChart);
