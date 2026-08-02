import { useMemo, useState } from 'react';
import type { PortfolioHolding } from '../api/portfolios';
import { formatCurrency, formatNumber, formatPercent, gainLossColorClass } from '../lib/format';

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
  onSymbolClick?: (symbol: string) => void;
}

type SortKey = 'symbol' | 'name' | 'sector' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'currentValue' | 'gainLoss' | 'returnPct' | 'allocationPct';
type SortDirection = 'asc' | 'desc';
type SizeTab = 'major' | 'minor';

// Splits the holdings list by allocation weight so the user can focus on the
// set that actually moves the portfolio, instead of scrolling past a long
// tail of small positions to find them. A null allocationPct (holdings
// haven't had a price refresh yet) defaults to the minor bucket rather than
// major, since "definitely a significant position" can't be claimed for it.
const MAJOR_THRESHOLD_PCT = 2.5;

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'purchasePrice', label: 'Avg Cost', align: 'right' },
  { key: 'currentPrice', label: 'Price', align: 'right' },
  { key: 'currentValue', label: 'Value', align: 'right' },
  { key: 'gainLoss', label: 'Gain/Loss', align: 'right' },
  { key: 'returnPct', label: 'Return %', align: 'right' },
  { key: 'allocationPct', label: 'Alloc %', align: 'right' },
];

// The fix for Architecture.md shortcoming #11: the source app's 10-column
// holdings table has zero responsive handling (horizontal-scroll only,
// css/... `.table-wrapper{overflow-x:auto}`). Below `md`, this renders each
// holding as a stacked card (symbol + value + gain/loss prominent, the rest
// underneath) instead of a table; `md:` and up renders the real table. Both
// markups exist in the DOM simultaneously — Tailwind's `md:hidden` /
// `hidden md:table` just toggle which one is visible, no JS viewport
// detection needed.
export default function HoldingsTable({ holdings, onSymbolClick }: HoldingsTableProps) {
  // Defaults to Value, descending, in both tabs - the largest positions (by $, not just
  // count) are what the Major/Minor split is meant to surface first.
  const [sortKey, setSortKey] = useState<SortKey | null>('currentValue');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [sizeTab, setSizeTab] = useState<SizeTab>('major');

  const majorHoldings = useMemo(
    () => holdings.filter((h) => (h.allocationPct ?? 0) > MAJOR_THRESHOLD_PCT),
    [holdings],
  );
  const minorHoldings = useMemo(
    () => holdings.filter((h) => (h.allocationPct ?? 0) <= MAJOR_THRESHOLD_PCT),
    [holdings],
  );
  const visibleHoldings = sizeTab === 'major' ? majorHoldings : minorHoldings;
  const majorValue = useMemo(() => majorHoldings.reduce((sum, h) => sum + h.currentValue, 0), [majorHoldings]);
  const minorValue = useMemo(() => minorHoldings.reduce((sum, h) => sum + h.currentValue, 0), [minorHoldings]);

  const sortedHoldings = useMemo(() => {
    if (!sortKey) return visibleHoldings;
    const withOriginalIndex = visibleHoldings.map((h, index) => ({ h, index }));
    withOriginalIndex.sort((a, b) => {
      const av = a.h[sortKey];
      const bv = b.h[sortKey];
      // Nulls always sort last, in BOTH directions - only the direction flip
      // below applies to two real values, not to a null-vs-real comparison.
      if (av == null && bv == null) return a.index - b.index;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number);
      if (cmp !== 0) return sortDirection === 'asc' ? cmp : -cmp;
      return a.index - b.index; // stable tiebreak
    });
    return withOriginalIndex.map((e) => e.h);
  }, [visibleHoldings, sortKey, sortDirection]);

  if (holdings.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings yet — import a CSV to get started.</p>;
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
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
      <div className="mb-3 flex gap-4 border-b border-border">
        <button
          type="button"
          onClick={() => setSizeTab('major')}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${sizeTab === 'major' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'}`}
        >
          MAJOR ({formatCurrency(majorValue)}) in #{majorHoldings.length} Stocks
        </button>
        <button
          type="button"
          onClick={() => setSizeTab('minor')}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${sizeTab === 'minor' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'}`}
        >
          MINOR ({formatCurrency(minorValue)}) in #{minorHoldings.length} Stocks
        </button>
      </div>

      {visibleHoldings.length === 0 && (
        <p className="text-sm text-text-secondary">
          {sizeTab === 'major' ? 'No holdings above the 2.5% allocation threshold.' : 'No holdings at or below the 2.5% allocation threshold.'}
        </p>
      )}

      {/* Mobile: card list — reflects whichever sort is active on the
          desktop table below (no separate mobile sort control). */}
      {visibleHoldings.length > 0 && (
      <div className="flex flex-col gap-3 md:hidden">
        {sortedHoldings.map((h) => (
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
      )}

      {/* Desktop: table */}
      {visibleHoldings.length > 0 && (
      <div className="hidden overflow-x-auto rounded-card border border-border bg-bg-card shadow-card md:block">
        <table className="w-full text-sm" data-testid="holdings-table">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              {COLUMNS.map((col) => (
                <th key={col.key} className={`whitespace-nowrap px-3 py-2 ${col.align === 'right' ? 'text-right' : ''}`}>
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className={`inline-flex items-center gap-1 font-medium hover:text-text-primary ${sortKey === col.key ? 'text-text-primary' : ''}`}
                  >
                    {col.label}
                    {sortKey === col.key && <span aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((h) => (
              <tr key={h.id} data-testid={`holdings-row-${h.symbol}`} className="border-b border-border last:border-0 text-text-primary">
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
      )}
    </div>
  );
}
