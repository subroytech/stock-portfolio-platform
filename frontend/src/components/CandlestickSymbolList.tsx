import { useState, type FormEvent } from 'react';
import { useCachedSymbolsList, type CandlestickInterval } from '../api/candlestick';
import { formatAsOf } from '../lib/format';
import CandlestickPopup from './CandlestickPopup';

// Stock Analysis - Candlestick Charts (Phase 1). A new, independent section of the Stock
// Analysis tab (the existing 4 quadrants are untouched) - a left-side list of every symbol
// already cached for candlestick viewing (shared across every user, since the underlying cache
// is symbol+interval-keyed, not per-user), plus a blank field to look up a brand-new one. Green
// rows have at least one cached interval within the 10-minute freshness window; grey rows don't
// (still viewable, just not live-fresh). Clicking a row - or submitting a new symbol - opens the
// full-screen pop-up.
export default function CandlestickSymbolList() {
  const { data, isLoading, isError } = useCachedSymbolsList();
  const [newSymbolInput, setNewSymbolInput] = useState('');
  const [selected, setSelected] = useState<{ symbol: string; interval: CandlestickInterval } | null>(null);

  function handleNewSymbolSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newSymbolInput.trim().toUpperCase();
    if (!trimmed) return;
    // Defaults to 1day - the interval most likely to already have data from another feature
    // (Momentum/Refresh Prices/etc. all share the same daily cache) - the pop-up's own
    // confirm-to-fetch flow handles it either way if nothing's there yet.
    setSelected({ symbol: trimmed, interval: '1day' });
    setNewSymbolInput('');
  }

  return (
    <div className="w-64 shrink-0 rounded-card border border-border bg-bg-card p-3" data-testid="candlestick-symbol-list">
      <h2 className="mb-2 text-sm font-semibold text-text-primary">Candlestick Charts</h2>

      <form onSubmit={handleNewSymbolSubmit} className="mb-3 flex gap-1.5">
        <input
          value={newSymbolInput}
          onChange={(e) => setNewSymbolInput(e.target.value.toUpperCase())}
          placeholder="New symbol…"
          maxLength={10}
          data-testid="candlestick-new-symbol-input"
          className="min-w-0 flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm uppercase tracking-wide text-text-primary"
        />
        <button
          type="submit"
          disabled={!newSymbolInput.trim()}
          data-testid="candlestick-new-symbol-go"
          className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          Go
        </button>
      </form>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {isError && <p className="text-sm text-danger">Could not load cached symbols.</p>}
      {data?.symbols?.length === 0 && (
        <p className="text-sm text-text-secondary" data-testid="candlestick-list-empty">
          No symbols cached yet — look one up above.
        </p>
      )}

      <div className="max-h-[28rem] space-y-1 overflow-y-auto" data-testid="candlestick-list">
        {data?.symbols?.map((s) => (
          <button
            key={s.symbol}
            type="button"
            onClick={() => setSelected({ symbol: s.symbol, interval: s.interval })}
            data-testid={`candlestick-list-row-${s.symbol}`}
            className={`block w-full rounded-btn px-2 py-1.5 text-left text-sm transition-colors hover:opacity-80 ${
              s.isFresh ? 'bg-success/10 text-success' : 'bg-border text-text-secondary'
            }`}
          >
            <span className="font-semibold">{s.symbol}</span>
            <span className="ml-2 text-xs opacity-80">{formatAsOf(s.updatedAt)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <CandlestickPopup
          symbol={selected.symbol}
          initialInterval={selected.interval}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
