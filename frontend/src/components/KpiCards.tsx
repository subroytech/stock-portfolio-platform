import type { PortfolioDetail } from '../api/portfolios';
import { formatCurrency, formatPercent, gainLossColorClass } from '../lib/format';

interface KpiCardsProps {
  portfolio: PortfolioDetail;
}

// All 8 KPI pills (the 4 persisted totals + the 4 "today" stats) share this exact shape/size -
// one grid of 8 equal-width columns (grid-cols-8 fills the section edge to edge, no leftover
// blank space on the right the way a flex-wrap row of variable-width pills would leave), each a
// fixed height so a long label/value (e.g. "Total Gain/Loss") doesn't grow its own pill taller
// than the others - truncate+title instead, same pattern as the Transaction History table's own
// Name-column overflow handling. Sharper corners (rounded, not rounded-full) per explicit
// direction - still called a "pill" but no longer a true stadium shape.
const PILL_CLASS = 'flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded border px-2 text-center';

export default function KpiCards({ portfolio }: KpiCardsProps) {
  const returnPct = portfolio.totalCostBasis > 0
    ? (portfolio.totalGainLoss / portfolio.totalCostBasis) * 100
    : 0;

  const baseCards = [
    { key: 'total-value', label: 'Total Value', value: formatCurrency(portfolio.totalPortfolioValue) },
    { key: 'holdings-value', label: 'Holdings Value', value: formatCurrency(portfolio.totalHoldingsValue) },
    { key: 'cash', label: 'Cash', value: formatCurrency(portfolio.cashAmount) },
    {
      key: 'total-gain-loss',
      label: 'Total Gain/Loss',
      value: `${formatCurrency(portfolio.totalGainLoss)} (${formatPercent(returnPct)})`,
      colorClass: gainLossColorClass(portfolio.totalGainLoss),
    },
  ];

  // Today's movement, derived from each holding's own todayChangeDollar - the same
  // DB-persisted, refreshPrices()-populated field AllocationChart's/PerformanceChart's own
  // "Today's $" modes already read. null until the portfolio's first refresh (per-holding, not
  // per-portfolio) - a holding that's never been refreshed contributes nothing to the
  // numerator, but its currentValue still counts toward yesterdayValueTotal below so the
  // denominator isn't missing real portfolio value.
  const withTodayChange = portfolio.holdings.filter((h) => h.todayChangeDollar != null);
  const hasTodayData = withTodayChange.length > 0;
  const todayDollarTotal = withTodayChange.reduce((sum, h) => sum + (h.todayChangeDollar ?? 0), 0);
  const yesterdayValueTotal = portfolio.holdings.reduce((sum, h) => sum + (h.currentValue - (h.todayChangeDollar ?? 0)), 0);
  const todayPercentTotal = yesterdayValueTotal > 0 ? (todayDollarTotal / yesterdayValueTotal) * 100 : 0;

  const gainers = withTodayChange.filter((h) => (h.todayChangeDollar ?? 0) > 0);
  const losers = withTodayChange.filter((h) => (h.todayChangeDollar ?? 0) < 0);
  const topGainer = gainers.length > 0
    ? gainers.reduce((best, h) => ((h.todayChangeDollar ?? 0) > (best.todayChangeDollar ?? 0) ? h : best))
    : null;
  const topLoser = losers.length > 0
    ? losers.reduce((worst, h) => ((h.todayChangeDollar ?? 0) < (worst.todayChangeDollar ?? 0) ? h : worst))
    : null;

  // Neutral (no sign to show yet) until the first refresh, then green/red by sign - same
  // semantic-tint convention gainLossColorClass already establishes elsewhere in this app.
  const todayTint = !hasTodayData
    ? 'border-border bg-bg-card text-text-secondary'
    : todayDollarTotal >= 0
      ? 'border-success/30 bg-success/10 text-success'
      : 'border-danger/30 bg-danger/10 text-danger';

  const topGainerText = topGainer ? `${topGainer.symbol} ${formatCurrency(topGainer.todayChangeDollar ?? 0)}` : 'None';
  const topLoserText = topLoser ? `${topLoser.symbol} ${formatCurrency(topLoser.todayChangeDollar ?? 0)}` : 'None';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {baseCards.map((card) => (
        <div
          key={card.key}
          data-testid={`kpi-${card.key}`}
          title={`${card.label}: ${card.value}`}
          className={`${PILL_CLASS} border-accent/20 bg-accent/5 ${card.colorClass ?? 'text-text-primary'}`}
        >
          <span className="w-full truncate text-xs font-normal text-text-secondary">{card.label}</span>
          <span className="w-full truncate text-sm font-semibold">{card.value}</span>
        </div>
      ))}

      <div data-testid="kpi-today-dollar" title={`Today's $: ${hasTodayData ? formatCurrency(todayDollarTotal) : '—'}`} className={`${PILL_CLASS} ${todayTint}`}>
        <span className="w-full truncate text-xs font-normal text-text-secondary">Today&rsquo;s $</span>
        <span className="w-full truncate text-sm font-semibold">{hasTodayData ? formatCurrency(todayDollarTotal) : '—'}</span>
      </div>
      <div data-testid="kpi-today-percent" title={`Today's %: ${hasTodayData ? formatPercent(todayPercentTotal) : '—'}`} className={`${PILL_CLASS} ${todayTint}`}>
        <span className="w-full truncate text-xs font-normal text-text-secondary">Today&rsquo;s %</span>
        <span className="w-full truncate text-sm font-semibold">{hasTodayData ? formatPercent(todayPercentTotal) : '—'}</span>
      </div>
      <div data-testid="kpi-top-gainer" title={`Top Gainer: ${topGainerText}`} className={`${PILL_CLASS} border-success/30 bg-success/10 text-success`}>
        <span className="w-full truncate text-xs font-normal text-text-secondary">Top Gainer</span>
        <span className="w-full truncate text-sm font-semibold">{topGainerText}</span>
      </div>
      <div data-testid="kpi-top-loser" title={`Top Loser: ${topLoserText}`} className={`${PILL_CLASS} border-danger/30 bg-danger/10 text-danger`}>
        <span className="w-full truncate text-xs font-normal text-text-secondary">Top Loser</span>
        <span className="w-full truncate text-sm font-semibold">{topLoserText}</span>
      </div>
    </div>
  );
}
