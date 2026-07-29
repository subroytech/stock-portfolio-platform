import type { ScanResult } from '../api/contrarianFinder';
import { contrarianSeverityClass, formatCompactCurrency, formatPercent } from '../lib/format';

interface ContrarianFinderResultsTableProps {
  results: ScanResult[];
  onSymbolClick?: (symbol: string) => void;
  onLongTermAnalysis?: (symbol: string) => void;
  onContrarianComeback?: (symbol: string) => void;
}

function volRatioDisplay(volume?: number, avgVol?: number): { text: string; hot: boolean } {
  if (!volume || !avgVol || avgVol <= 0) return { text: '—', hot: false };
  const ratio = volume / avgVol;
  return { text: `${ratio.toFixed(1)}×`, hot: ratio >= 2 };
}

// Same card/table responsive split as HoldingsTable — the source app's
// Contrarian Finder results table (.cf-table) has the identical
// horizontal-scroll-only problem the holdings table does.
export default function ContrarianFinderResultsTable({ results, onSymbolClick, onLongTermAnalysis, onContrarianComeback }: ContrarianFinderResultsTableProps) {
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

  function launchButtons(symbol: string) {
    if (!onLongTermAnalysis && !onContrarianComeback) return null;
    return (
      <span className="inline-flex gap-1">
        {onLongTermAnalysis && (
          <button
            type="button"
            onClick={() => onLongTermAnalysis(symbol)}
            title="Long-Term Analysis"
            className="rounded border border-border px-1 text-[.63rem] font-medium text-text-secondary hover:border-accent hover:text-accent"
          >
            LT
          </button>
        )}
        {onContrarianComeback && (
          <button
            type="button"
            onClick={() => onContrarianComeback(symbol)}
            title="Contrarian Comeback"
            className="rounded border border-border px-1 text-[.63rem] font-medium text-text-secondary hover:border-accent hover:text-accent"
          >
            CC
          </button>
        )}
      </span>
    );
  }

  return (
    <div>
      {/* Mobile: card list */}
      <div className="flex flex-col gap-3 md:hidden">
        {results.map((r) => {
          const vol = volRatioDisplay(r.volume, r.avgVol);
          return (
            <div key={r.symbol} className="rounded-card border border-border bg-bg-card p-4 shadow-card">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-1.5">
                  {symbolButton(r.symbol, 'font-semibold text-text-primary')}
                  {launchButtons(r.symbol)}
                </span>
                <span className="flex items-center gap-2">
                  {r.changePct != null && (
                    <span className={contrarianSeverityClass(r.changePct)}>{formatPercent(r.changePct)}</span>
                  )}
                  <span className="text-[.63rem] text-text-muted">{r.mktClosed ? 'Closed' : 'Open'}</span>
                </span>
              </div>
              {r.name && <p className="text-xs text-text-muted">{r.name}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
                <div className="flex justify-between"><dt>Sector</dt><dd>{r.sector ?? '—'}</dd></div>
                <div className="flex justify-between"><dt>Price</dt><dd>{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</dd></div>
                <div className="flex justify-between"><dt>Mkt Cap</dt><dd>{r.mktCap != null ? formatCompactCurrency(r.mktCap) : '—'}</dd></div>
                <div className="flex justify-between"><dt>Vol/Avg</dt><dd className={vol.hot ? 'font-semibold text-warning' : ''}>{vol.text}</dd></div>
                <div className="flex justify-between"><dt>Found In</dt><dd className="text-[#8b5cf6]">{r.source ?? '—'}</dd></div>
                {r.strength && (
                  <>
                    <div className="flex justify-between"><dt>RSI</dt><dd>{r.strength.rsi.toFixed(1)}</dd></div>
                    <div className="flex justify-between"><dt>R:R</dt><dd>{r.strength.rr.toFixed(2)}</dd></div>
                    <div className="flex justify-between"><dt>Half-Kelly</dt><dd>{(r.strength.halfKelly * 100).toFixed(1)}%</dd></div>
                  </>
                )}
              </dl>
            </div>
          );
        })}
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
              <th className="whitespace-nowrap px-3 py-2 text-right">Mkt Cap</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Vol/Avg</th>
              <th className="whitespace-nowrap px-3 py-2">Found In</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">RSI</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">R:R</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Half-Kelly</th>
              {(onLongTermAnalysis || onContrarianComeback) && <th className="whitespace-nowrap px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const vol = volRatioDisplay(r.volume, r.avgVol);
              return (
                <tr key={r.symbol} className="border-b border-border last:border-0 text-text-primary hover:bg-bg-primary">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{symbolButton(r.symbol, 'font-medium text-text-primary')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.name ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.sector ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className={r.changePct != null ? contrarianSeverityClass(r.changePct) : ''}>
                      {r.changePct != null ? formatPercent(r.changePct) : '—'}
                    </span>
                    <span className="ml-1 text-[.63rem] text-text-muted">{r.mktClosed ? 'Closed' : 'Open'}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-text-secondary">{r.mktCap != null ? formatCompactCurrency(r.mktCap) : '—'}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${vol.hot ? 'font-semibold text-warning' : ''}`}>{vol.text}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[.68rem] text-[#8b5cf6]">{r.source ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rsi.toFixed(1) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? r.strength.rr.toFixed(2) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{r.strength ? `${(r.strength.halfKelly * 100).toFixed(1)}%` : '—'}</td>
                  {(onLongTermAnalysis || onContrarianComeback) && <td className="whitespace-nowrap px-3 py-2">{launchButtons(r.symbol)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
