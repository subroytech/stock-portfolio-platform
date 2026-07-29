import type { ScanResult } from '../api/contrarianFinder';

interface StrengthListTableProps {
  results: ScanResult[];
  onSymbolClick?: (symbol: string) => void;
}

// Bullish "strength" screen candidates (RSI ideal zone, above both SMAs,
// hasn't already spiked) — built from a Contrarian Finder scan's full
// results list (not just the decline candidates), ported from the source
// app's window.cfStrengthList (contrarian-finder.js:418-421). Same
// mobile-card/desktop-table responsive split and symbol-click-to-preview
// pattern as ContrarianFinderResultsTable, kept as a separate component
// since the columns genuinely differ (no Change%/decline coloring here,
// adds SMA20/SMA50/full Kelly%).
export default function StrengthListTable({ results, onSymbolClick }: StrengthListTableProps) {
  if (results.length === 0) {
    return <p className="text-sm text-text-secondary">No strength-list candidates in this scan.</p>;
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
              {r.price != null && <span className="text-text-primary">${r.price.toFixed(2)}</span>}
            </div>
            {r.name && <p className="text-xs text-text-muted">{r.name}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
              <div className="flex justify-between"><dt>Sector</dt><dd>{r.sector ?? '—'}</dd></div>
              {r.strength && (
                <>
                  <div className="flex justify-between"><dt>RSI</dt><dd>{r.strength.rsi.toFixed(1)}</dd></div>
                  <div className="flex justify-between"><dt>SMA20</dt><dd>${r.strength.sma20.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt>SMA50</dt><dd>${r.strength.sma50.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt>R:R</dt><dd>{r.strength.rr.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt>Kelly %</dt><dd>{(r.strength.kF * 100).toFixed(1)}%</dd></div>
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
              <th className="whitespace-nowrap px-3 py-2 text-right">RSI</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">SMA20</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">SMA50</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">R:R</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Kelly %</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Half-Kelly</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.symbol} className="border-b border-border last:border-0 text-text-primary hover:bg-bg-primary">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{symbolButton(r.symbol, 'font-medium text-text-primary')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.name ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.sector ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rsi.toFixed(1) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `$${r.strength.sma20.toFixed(2)}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `$${r.strength.sma50.toFixed(2)}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rr.toFixed(2) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `${(r.strength.kF * 100).toFixed(1)}%` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `${(r.strength.halfKelly * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
