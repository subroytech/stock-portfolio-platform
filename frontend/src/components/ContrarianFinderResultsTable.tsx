import type { ScanResult } from '../api/contrarianFinder';
import { formatPercent, gainLossColorClass } from '../lib/format';

interface ContrarianFinderResultsTableProps {
  results: ScanResult[];
  onSymbolClick?: (symbol: string) => void;
}

// Same card/table responsive split as HoldingsTable — the source app's
// Contrarian Finder results table (.cf-table) has the identical
// horizontal-scroll-only problem the holdings table does.
export default function ContrarianFinderResultsTable({ results, onSymbolClick }: ContrarianFinderResultsTableProps) {
  if (results.length === 0) {
    return <p className="text-sm text-text-secondary">No candidates matched this scan's threshold.</p>;
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
        {results.map((r) => (
          <div key={r.symbol} className="rounded-card border border-border bg-bg-card p-4 shadow-card">
            <div className="flex items-baseline justify-between">
              {symbolButton(r.symbol, 'font-semibold text-text-primary')}
              {r.changePct != null && (
                <span className={gainLossColorClass(r.changePct)}>{formatPercent(r.changePct)}</span>
              )}
            </div>
            {r.name && <p className="text-xs text-text-muted">{r.name}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
              <div className="flex justify-between"><dt>Sector</dt><dd>{r.sector ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Price</dt><dd>{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</dd></div>
              {r.strength && (
                <>
                  <div className="flex justify-between"><dt>RSI</dt><dd>{r.strength.rsi.toFixed(1)}</dd></div>
                  <div className="flex justify-between"><dt>R:R</dt><dd>{r.strength.rr.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt>Half-Kelly</dt><dd>{(r.strength.halfKelly * 100).toFixed(1)}%</dd></div>
                </>
              )}
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
              <th className="whitespace-nowrap px-3 py-2 text-right">Price</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Change %</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">RSI</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">R:R</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Half-Kelly</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.symbol} className="border-b border-border last:border-0 text-text-primary">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{symbolButton(r.symbol, 'font-medium text-text-primary')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.name ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.sector ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${r.changePct != null ? gainLossColorClass(r.changePct) : ''}`}>
                  {r.changePct != null ? formatPercent(r.changePct) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rsi.toFixed(1) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rr.toFixed(2) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `${(r.strength.halfKelly * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
