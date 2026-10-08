import { useStockAnalysisTickers, QUADRANT_COUNT } from '../lib/stockAnalysisTickers';
import StockAnalysisQuadrant from '../components/StockAnalysisQuadrant';
import CandlestickSymbolList from '../components/CandlestickSymbolList';

// A real, confirmed gap: no way to look up price/history for a ticker that isn't already a
// portfolio holding or the subject of a completed analysis run (see CLAUDE.md's "Stock
// Analysis" section). GET /stock-preview/:symbol and StockPreviewBody already fully support any
// ticker - this page is purely a new entry point, 4 independent quadrants so several tickers can
// sit side-by-side at once.
//
// Candlestick Charts (Phase 1) - a new, independent section (CandlestickSymbolList), not a
// replacement for the 4 quadrants above, which stay exactly as they were.
export default function StockAnalysisPage() {
  const { slots, setSlot, clearSlot } = useStockAnalysisTickers();

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:items-start">
      <CandlestickSymbolList />
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: QUADRANT_COUNT }, (_, i) => (
          <StockAnalysisQuadrant
            key={i}
            symbol={slots[i]}
            onSet={(symbol) => setSlot(i, symbol)}
            onClear={() => clearSlot(i)}
          />
        ))}
      </div>
    </main>
  );
}
