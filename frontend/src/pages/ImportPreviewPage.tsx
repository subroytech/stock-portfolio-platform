import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useImportHoldings, type ImportPreviewResult, type PortfolioHolding } from '../api/portfolios';
import { ApiError } from '../api/client';
import HoldingsTable from '../components/HoldingsTable';
import { formatCurrency } from '../lib/format';

interface LocationState {
  filename: string;
  content: string;
  preview: ImportPreviewResult;
}

// Maps the as-parsed preview shape (no id/allocationPct/priceUpdatedAt — those
// only exist once a real import writes to tx_holdings) into what
// HoldingsTable expects, so the preview reuses the same responsive
// card/table component instead of a second, duplicate table.
function toPreviewHoldings(preview: ImportPreviewResult): PortfolioHolding[] {
  const total = preview.holdings.reduce((s, h) => s + h.currentValue, 0);
  return preview.holdings.map((h, i) => ({
    id: `preview-${i}-${h.symbol}`,
    symbol: h.symbol,
    name: h.name || null,
    quantity: h.quantity,
    purchasePrice: h.purchasePrice,
    currentPrice: h.currentPrice,
    sector: h.sector || null,
    purchaseDate: h.purchaseDate || null,
    costBasis: h.costBasis,
    currentValue: h.currentValue,
    gainLoss: h.gainLoss,
    returnPct: h.returnPct,
    allocationPct: total > 0 ? (h.currentValue / total) * 100 : null,
    priceUpdatedAt: null,
  }));
}

export default function ImportPreviewPage() {
  const { id: portfolioId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const importHoldings = useImportHoldings(portfolioId ?? '');

  const state = location.state as LocationState | null;

  // Direct navigation / refresh / bookmark — there's nothing to preview
  // without having just come from the upload dialog, so bounce home rather
  // than show a blank page.
  if (!state || !portfolioId) {
    return <Navigate to="/" replace />;
  }

  const { filename, content, preview } = state;
  const holdings = toPreviewHoldings(preview);

  async function handleImportNow() {
    await importHoldings.mutateAsync({ filename, content });
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-4 shadow-card sm:px-6">
        <h1 className="text-lg font-semibold text-text-primary">Import Preview</h1>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-sm text-accent hover:underline"
        >
          Back to dashboard
        </button>
      </header>

      <main className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-card border border-warning bg-warning/10 p-4">
          <p className="font-semibold text-warning">⚠ Unsaved — this file has not been imported</p>
          <p className="mt-1 text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{filename}</span> was parsed but nothing has been
            written to this portfolio. Nothing changes until you choose Import Now below.
          </p>
        </div>

        {importHoldings.isError && (
          <p className="text-sm text-danger">
            {importHoldings.error instanceof ApiError ? importHoldings.error.message : 'Import failed.'}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4 rounded-card bg-bg-card p-4 shadow-card">
          <span className="text-sm text-text-secondary">{holdings.length} holdings parsed</span>
          <span className="text-sm text-text-secondary">Cash: {formatCurrency(preview.cashAmount)}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleImportNow}
              disabled={importHoldings.isPending}
              className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {importHoldings.isPending ? 'Importing…' : 'Import Now'}
            </button>
          </div>
        </div>

        {preview.errors.length > 0 && (
          <div className="rounded-card border border-warning bg-warning/10 p-4">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">
              {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} had issues
            </h2>
            <ul className="list-inside list-disc text-sm text-text-secondary">
              {preview.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}

        <HoldingsTable holdings={holdings} />
      </main>
    </div>
  );
}
