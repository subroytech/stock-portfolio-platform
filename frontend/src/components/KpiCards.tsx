import type { PortfolioDetail } from '../api/portfolios';
import { formatCurrency, formatPercent, gainLossColorClass } from '../lib/format';
import { getTopSectors } from '../lib/sectorBars';

interface KpiCardsProps {
  portfolio: PortfolioDetail;
  // 'allocation' shows the six pills above the Allocation card; 'performance' the six above the Performance card.
  group: 'allocation' | 'performance';
}

// Width weights (2026-11-15). The widest pills get weight 5; the 80% pills get 4, so they render at
// 80% of the widest. Each pill keeps a minimum width so the text stays readable on a narrow screen.
const WIDE = 5;
const EIGHTY = 4;
const MIN_WIDTH = '7rem';

const PILL_CLASS = 'flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded border px-2 text-center';

// Sector pill (2026-11-15): no label. Line 1 is the sector name, line 2 its signed dollar change;
// both lines use the value style, since both are data.
function SectorPill({ testId, sector, change, tint }: { testId: string; sector: string | null; change: number | null; tint: string }) {
  const name = sector ?? 'None';
  const amount = change == null ? '' : `${change >= 0 ? '+' : ''}${formatCurrency(change)}`;
  return (
    <div data-testid={testId} title={change == null ? name : `${name} ${amount}`} className={`${PILL_CLASS} ${tint}`} style={{ flex: `${WIDE} 1 0%`, minWidth: MIN_WIDTH }}>
      <span className="w-full truncate rounded bg-[#115e59] px-2 py-0.5 text-sm font-semibold text-[#f0fdfa]">{name}</span>
      <span className="w-full truncate text-sm font-semibold">{change == null ? '—' : amount}</span>
    </div>
  );
}

function Pill({ testId, label, value, tint, weight }: { testId: string; label: string; value: string; tint: string; weight: number }) {
  return (
    <div
      data-testid={testId}
      title={`${label}: ${value}`}
      className={`${PILL_CLASS} ${tint}`}
      style={{ flex: `${weight} 1 0%`, minWidth: MIN_WIDTH }}
    >
      <span className="w-full truncate text-xs font-semibold text-text-secondary">{label}</span>
      <span className="w-full truncate text-sm font-semibold">{value}</span>
    </div>
  );
}

const NEUTRAL = 'border-border bg-bg-card text-text-secondary';
const GAIN = 'border-success/30 bg-success/10 text-success';
const LOSS = 'border-danger/30 bg-danger/10 text-danger';
const ACCENT = 'border-accent/20 bg-accent/5 text-text-primary';

export default function KpiCards({ portfolio, group }: KpiCardsProps) {
  const returnPct = portfolio.totalCostBasis > 0
    ? (portfolio.totalGainLoss / portfolio.totalCostBasis) * 100
    : 0;

  // Today's movement, from each holding's persisted todayChangeDollar / todayChangePercent (set by
  // Refresh Prices). Null until the first refresh.
  const withTodayChange = portfolio.holdings.filter((h) => h.todayChangeDollar != null);
  const hasTodayData = withTodayChange.length > 0;
  const todayDollarTotal = withTodayChange.reduce((sum, h) => sum + (h.todayChangeDollar ?? 0), 0);
  const yesterdayValueTotal = portfolio.holdings.reduce((sum, h) => sum + (h.currentValue - (h.todayChangeDollar ?? 0)), 0);
  const todayPercentTotal = yesterdayValueTotal > 0 ? (todayDollarTotal / yesterdayValueTotal) * 100 : 0;
  const todayTint = !hasTodayData ? NEUTRAL : todayDollarTotal >= 0 ? GAIN : LOSS;

  if (group === 'allocation') {
    return (
      <div className="flex gap-2 overflow-x-auto" data-testid="kpi-group-allocation">
        <Pill weight={EIGHTY} testId="kpi-total-value" label="Total $$" value={formatCurrency(portfolio.totalPortfolioValue)} tint={ACCENT} />
        <Pill weight={EIGHTY} testId="kpi-holdings-value" label="Holding $$" value={formatCurrency(portfolio.totalHoldingsValue)} tint={ACCENT} />
        <Pill weight={EIGHTY} testId="kpi-cash" label="Cash" value={formatCurrency(portfolio.cashAmount)} tint={ACCENT} />
        <Pill
          weight={WIDE}
          testId="kpi-total-gain-loss"
          label="Total Gain/Loss"
          value={`${formatCurrency(portfolio.totalGainLoss)} (${formatPercent(returnPct)})`}
          tint={`border-accent/20 bg-accent/5 ${gainLossColorClass(portfolio.totalGainLoss)}`}
        />
        <Pill weight={EIGHTY} testId="kpi-today-dollar" label="Today's $" value={hasTodayData ? formatCurrency(todayDollarTotal) : '—'} tint={todayTint} />
        <Pill weight={EIGHTY} testId="kpi-today-percent" label="% Today's" value={hasTodayData ? formatPercent(todayPercentTotal) : '—'} tint={todayTint} />
      </div>
    );
  }

  // Stock-level figures span every holding, whatever its size.
  const gainers = withTodayChange.filter((h) => (h.todayChangeDollar ?? 0) > 0);
  const losers = withTodayChange.filter((h) => (h.todayChangeDollar ?? 0) < 0);
  const topGainer = gainers.length > 0
    ? gainers.reduce((best, h) => ((h.todayChangeDollar ?? 0) > (best.todayChangeDollar ?? 0) ? h : best))
    : null;
  const topLoser = losers.length > 0
    ? losers.reduce((worst, h) => ((h.todayChangeDollar ?? 0) < (worst.todayChangeDollar ?? 0) ? h : worst))
    : null;

  const withPct = portfolio.holdings.filter((h) => h.todayChangePercent != null);
  const pctGainers = withPct.filter((h) => (h.todayChangePercent ?? 0) > 0);
  const pctLosers = withPct.filter((h) => (h.todayChangePercent ?? 0) < 0);
  const topGainerPct = pctGainers.length > 0
    ? pctGainers.reduce((best, h) => ((h.todayChangePercent ?? 0) > (best.todayChangePercent ?? 0) ? h : best))
    : null;
  const topLoserPct = pctLosers.length > 0
    ? pctLosers.reduce((worst, h) => ((h.todayChangePercent ?? 0) < (worst.todayChangePercent ?? 0) ? h : worst))
    : null;

  // Day change per Top-6 sector: the sum of its holdings' todayChangeDollar (never-refreshed holdings count as 0).
  // Top Sector $ +/- consider the top 12 sectors (2026-11-16).
  const sectorDay = getTopSectors(portfolio.holdings, 12)
    .map((g) => ({
      sector: g.sector,
      change: g.holdings.reduce((sum, h) => sum + (h.todayChangeDollar ?? 0), 0),
      refreshed: g.holdings.some((h) => h.todayChangeDollar != null),
    }))
    .filter((s) => s.refreshed);
  const topSectorGain = sectorDay.filter((s) => s.change > 0).reduce<{ sector: string; change: number } | null>(
    (best, s) => (best === null || s.change > best.change ? s : best), null,
  );
  const topSectorLoss = sectorDay.filter((s) => s.change < 0).reduce<{ sector: string; change: number } | null>(
    (worst, s) => (worst === null || s.change < worst.change ? s : worst), null,
  );

  const topGainerText = topGainer ? `${topGainer.symbol} ${formatCurrency(topGainer.todayChangeDollar ?? 0)}` : 'None';
  const topLoserText = topLoser ? `${topLoser.symbol} ${formatCurrency(topLoser.todayChangeDollar ?? 0)}` : 'None';
  const topGainerPctText = topGainerPct ? `${topGainerPct.symbol} ${formatPercent(topGainerPct.todayChangePercent ?? 0)}` : 'None';
  const topLoserPctText = topLoserPct ? `${topLoserPct.symbol} ${formatPercent(topLoserPct.todayChangePercent ?? 0)}` : 'None';

  return (
    <div className="flex gap-2 overflow-x-auto" data-testid="kpi-group-performance">
      <Pill weight={EIGHTY} testId="kpi-top-gainer" label="Top Gainer" value={topGainerText} tint={GAIN} />
      <Pill weight={EIGHTY} testId="kpi-top-loser" label="Top Loser" value={topLoserText} tint={LOSS} />
      <Pill weight={EIGHTY} testId="kpi-top-gainer-pct" label="% Top Gainer" value={topGainerPctText} tint={GAIN} />
      <Pill weight={EIGHTY} testId="kpi-top-loser-pct" label="% Top Loser" value={topLoserPctText} tint={LOSS} />
      <SectorPill testId="kpi-top-sector-gain" sector={topSectorGain?.sector ?? null} change={topSectorGain?.change ?? null} tint={GAIN} />
      <SectorPill testId="kpi-top-sector-loss" sector={topSectorLoss?.sector ?? null} change={topSectorLoss?.change ?? null} tint={LOSS} />
    </div>
  );
}
