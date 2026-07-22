import type { PortfolioDetail } from '../api/portfolios';
import { formatCurrency, formatPercent, gainLossColorClass } from '../lib/format';

interface KpiCardsProps {
  portfolio: PortfolioDetail;
}

// Mobile-first: single column on phones, up to 4 across on desktop. Source
// app's equivalent (.kpi-grid) was a fixed 4-column grid with no responsive
// treatment below 1199px other than dropping to 2 columns — this scales down
// one column further to a true single column on small phones.
export default function KpiCards({ portfolio }: KpiCardsProps) {
  const returnPct = portfolio.totalCostBasis > 0
    ? (portfolio.totalGainLoss / portfolio.totalCostBasis) * 100
    : 0;

  const cards = [
    { label: 'Total Value', value: formatCurrency(portfolio.totalPortfolioValue) },
    { label: 'Holdings Value', value: formatCurrency(portfolio.totalHoldingsValue) },
    { label: 'Cash', value: formatCurrency(portfolio.cashAmount) },
    {
      label: 'Total Gain/Loss',
      value: `${formatCurrency(portfolio.totalGainLoss)} (${formatPercent(returnPct)})`,
      colorClass: gainLossColorClass(portfolio.totalGainLoss),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          data-testid={`kpi-${card.label.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-')}`}
          className="rounded-card bg-bg-card p-4 shadow-card"
        >
          <p className="text-sm text-text-secondary">{card.label}</p>
          <p className={`mt-1 text-xl font-semibold ${card.colorClass ?? 'text-text-primary'}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
