import type { PortfolioHolding } from '../api/portfolios';
import { formatCurrency, formatNumber, formatPercent, gainLossColorClass } from '../lib/format';

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
  onSymbolClick?: (symbol: string) => void;
}

// The fix for Architecture.md shortcoming #11: the source app's 10-column
// holdings table has zero responsive handling (horizontal-scroll only,
// css/... `.table-wrapper{overflow-x:auto}`). Below `md`, this renders each
// holding as a stacked card (symbol + value + gain/loss prominent, the rest
// underneath) instead of a table; `md:` and up renders the real table. Both
// markups exist in the DOM simultaneously — Tailwind's `md:hidden` /
// `hidden md:table` just toggle which one is visible, no JS viewport
// detection needed.
export default function HoldingsTable({ holdings, onSymbolClick }: HoldingsTableProps) {
  if (holdings.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings yet — import a CSV to get started.</p>;
  }

  function symbolButton(symbol: string, className: string) {
    if (!onSymbolClick) return <span className={className}>{symbol}</span>;
    return (
      <button type="button" onClick={() => onSymbolClick(symbol)} className={`${className} hover:underline`}>
        {symbol}
      </button>
    );
  }

  return (
    <div>
      {/* Mobile: card list */}
      <div className="flex flex-col gap-3 md:hidden">
        {holdings.map((h) => (
          <div key={h.id} className="rounded-card border border-border bg-bg-card p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              {symbolButton(h.symbol, 'font-semibold text-text-primary')}
              <span className="font-semibold text-text-primary">{formatCurrency(h.currentValue)}</span>
            </div>
            {h.name && <p className="text-xs text-text-muted">{h.name}</p>}
            <div className="mt-2 flex items-baseline justify-between text-sm">
              <span className={gainLossColorClass(h.gainLoss)}>
                {formatCurrency(h.gainLoss)} ({formatPercent(h.returnPct)})
              </span>
              <span className="text-text-secondary">{formatNumber(h.quantity)} sh</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
              <div className="flex justify-between"><dt>Sector</dt><dd>{h.sector ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Avg cost</dt><dd>{formatCurrency(h.purchasePrice)}</dd></div>
              <div className="flex justify-between"><dt>Price</dt><dd>{formatCurrency(h.currentPrice)}</dd></div>
              <div className="flex justify-between"><dt>Alloc</dt><dd>{h.allocationPct != null ? `${h.allocationPct.toFixed(1)}%` : '—'}</dd></div>
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-bg-card shadow-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="whitespace-nowrap px-3 py-2">Symbol</th>
              <th className="whitespace-nowrap px-3 py-2">Name</th>
              <th className="whitespace-nowrap px-3 py-2">Sector</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Qty</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Avg Cost</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Price</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Value</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Gain/Loss</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Return %</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Alloc %</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id} className="border-b border-border last:border-0 text-text-primary">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{symbolButton(h.symbol, 'font-medium text-text-primary')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{h.name ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{h.sector ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatNumber(h.quantity)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(h.purchasePrice)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(h.currentPrice)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatCurrency(h.currentValue)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${gainLossColorClass(h.gainLoss)}`}>{formatCurrency(h.gainLoss)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${gainLossColorClass(h.returnPct)}`}>{formatPercent(h.returnPct)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{h.allocationPct != null ? `${h.allocationPct.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
