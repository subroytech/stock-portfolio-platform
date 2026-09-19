import StockPreviewBody from './StockPreviewBody';

interface StockPreviewChartProps {
  symbol: string;
  onClose: () => void;
}

// Modal, triggered by clicking a symbol in HoldingsTable / ContrarianFinderResultsTable
// (matches the source app's embedded-widget usage pattern, see the Phase 3 plan). The actual
// header/chart/pills rendering lives in StockPreviewBody, shared with the Stock Analysis tab's
// inline quadrants - this component is just the popup chrome around it.
export default function StockPreviewChart({ symbol, onClose }: StockPreviewChartProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl rounded-card bg-bg-card p-6 shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-btn px-2 py-1 text-text-secondary hover:bg-bg-primary"
        >
          ✕
        </button>
        <StockPreviewBody symbol={symbol} />
      </div>
    </div>
  );
}
