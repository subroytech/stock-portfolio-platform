interface TickerSubTabsProps {
  symbols: string[];
  activeSymbol: string | null;
  pendingSymbol?: string | null;
  onSelect: (symbol: string) => void;
  onClose: (symbol: string) => void;
}

// The up-to-15-ticker sub-tab strip shared by Long-Term Analysis and
// Contrarian Comeback - each page owns its own independent
// useTickerHistory() instance, this is just the presentational piece. A
// pendingSymbol (a brand-new ticker whose fetch hasn't resolved yet, so it
// has no history entry) renders as a plain loading pill with no close icon,
// distinct from the real (closable) tabs.
export default function TickerSubTabs({ symbols, activeSymbol, pendingSymbol, onSelect, onClose }: TickerSubTabsProps) {
  if (symbols.length === 0 && !pendingSymbol) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist">
      {symbols.map((symbol) => {
        const active = symbol === activeSymbol;
        return (
          <span
            key={symbol}
            role="tab"
            aria-selected={active}
            className={`inline-flex items-center gap-1 rounded-btn px-2 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-border'
            }`}
          >
            <button type="button" onClick={() => onSelect(symbol)} className="hover:underline">
              {symbol}
            </button>
            <button
              type="button"
              onClick={() => onClose(symbol)}
              aria-label={`Close ${symbol}`}
              className="leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </span>
        );
      })}
      {pendingSymbol && (
        <span className="inline-flex items-center gap-1.5 rounded-btn bg-bg-primary px-2 py-1 text-xs font-medium text-text-muted">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-border border-t-accent" />
          {pendingSymbol}
        </span>
      )}
    </div>
  );
}
