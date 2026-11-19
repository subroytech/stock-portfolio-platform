import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCachedSymbolsList, type CandlestickInterval } from '../api/candlestick';
import { useSession } from '../api/auth';
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
  const navigate = useNavigate();
  const { data: session } = useSession();
  // Candlestick Pattern Q&A - a contextual link into that feature's own route, not a top-level
  // nav tab (moved off the header 2026-09-21 per explicit direction: this feature lives inside
  // Stock Analysis now, not alongside Portfolio/Momentum/etc.). Same destination route as
  // CandlestickPopup.tsx's own "Ask about patterns" shortcut, deliberately different label so
  // the two don't read as duplicates of each other.
  const canCandlestickQuestionAnswer = session?.permissions?.includes('candlestick_question_answer:ask') ?? false;
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Candlestick Charts</h2>
        {canCandlestickQuestionAnswer && (
          <button
            type="button"
            onClick={() => navigate('/candlestick-question-answer')}
            data-testid="candlestick-pattern-qa-link"
            className="shrink-0 rounded-btn bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
          >
            Tutorial →
          </button>
        )}
      </div>

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
