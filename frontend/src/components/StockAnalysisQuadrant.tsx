import { useState, type FormEvent } from 'react';
import { useTickerHandoff } from '../lib/tickerHandoff';
import StockPreviewBody from './StockPreviewBody';

interface StockAnalysisQuadrantProps {
  symbol: string | null;
  onSet: (symbol: string) => void;
  onClear: () => void;
}

// One quadrant of the Stock Analysis tab - an explicit ticker + Go submit (matching this
// platform's own established pattern on Momentum/Long-Term Analysis/Contrarian Comeback, not
// the source app's live-as-you-type), plus a Clear to empty it back out. Any ticker, independent
// of portfolio holdings or a completed analysis run - StockPreviewBody does the real work.
//
// The source app's own ticker widget (js/stock-preview-chart.js, embedded in its Contrarian
// Comeback card) paired the live preview with "Go"/"Long" buttons that opened a full Contrarian
// Comeback / Long-Term Analysis for the same typed ticker - LT/CC below are that same idea,
// reusing this platform's own existing cross-tab launcher (lib/tickerHandoff.ts) instead of a
// new-tab window.open(), since ContrarianFinderPage's result rows already establish that exact
// launch pattern (and its LT/CC button styling, mirrored here for consistency).
export default function StockAnalysisQuadrant({ symbol, onSet, onClear }: StockAnalysisQuadrantProps) {
  const [input, setInput] = useState('');
  const { launch } = useTickerHandoff();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return;
    onSet(trimmed);
    setInput('');
  }

  return (
    <div className="flex min-h-[22rem] flex-col rounded-card bg-bg-card p-4 shadow-card">
      {!symbol ? (
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col items-center justify-center gap-2">
          <label className="flex flex-col items-center gap-1 text-sm text-text-secondary">
            Ticker
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="AAPL"
              maxLength={10}
              data-testid="stock-analysis-quadrant-input"
              className="w-32 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-center text-sm font-semibold uppercase tracking-wide text-text-primary"
            />
          </label>
          <button
            type="submit"
            disabled={!input.trim()}
            data-testid="stock-analysis-quadrant-go"
            className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            Go
          </button>
        </form>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between">
            <span className="inline-flex gap-1">
              <button
                type="button"
                onClick={() => launch('long-term-analysis', symbol)}
                title="Long-Term Analysis"
                data-testid="stock-analysis-quadrant-lt"
                className="rounded border border-border px-1 text-[.63rem] font-medium text-text-secondary hover:border-accent hover:text-accent"
              >
                LT
              </button>
              <button
                type="button"
                onClick={() => launch('contrarian-comeback', symbol)}
                title="Contrarian Comeback"
                data-testid="stock-analysis-quadrant-cc"
                className="rounded border border-border px-1 text-[.63rem] font-medium text-text-secondary hover:border-accent hover:text-accent"
              >
                CC
              </button>
            </span>
            <button
              type="button"
              onClick={onClear}
              data-testid="stock-analysis-quadrant-clear"
              className="rounded-btn px-2 py-1 text-xs text-text-secondary hover:bg-bg-primary"
            >
              ✕ Clear
            </button>
          </div>
          <StockPreviewBody symbol={symbol} />
        </>
      )}
    </div>
  );
}
