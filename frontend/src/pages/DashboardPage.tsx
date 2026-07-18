import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLogout } from '../api/auth';
import { usePortfolio, useRefreshPrices } from '../api/portfolios';
import { ApiError } from '../api/client';
import PortfolioSelector from '../components/PortfolioSelector';
import UploadImportDialog from '../components/UploadImportDialog';
import KpiCards from '../components/KpiCards';
import AllocationChart from '../components/AllocationChart';
import PerformanceChart from '../components/PerformanceChart';
import HoldingsTable from '../components/HoldingsTable';
import StockPreviewChart from '../components/StockPreviewChart';

export default function DashboardPage() {
  const logout = useLogout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const { data: portfolio, isLoading } = usePortfolio(selectedId);
  const refreshPrices = useRefreshPrices(selectedId ?? '');

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-4 shadow-card sm:px-6">
        <h1 className="text-lg font-semibold text-text-primary">Stock Portfolio Platform</h1>
        <nav className="flex items-center gap-3">
          <Link to="/momentum" className="text-sm text-text-secondary hover:text-accent">Momentum</Link>
          <Link to="/contrarian-finder" className="text-sm text-text-secondary hover:text-accent">Contrarian Finder</Link>
          <Link to="/subscriptions" className="text-sm text-text-secondary hover:text-accent">API Keys</Link>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-primary"
          >
            Log out
          </button>
        </nav>
      </header>

      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <PortfolioSelector selectedId={selectedId} onSelect={setSelectedId} />

        {!selectedId && (
          <p className="text-sm text-text-secondary">Select or create a portfolio to get started.</p>
        )}

        {selectedId && isLoading && <p className="text-sm text-text-secondary">Loading portfolio…</p>}

        {selectedId && portfolio && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bg-card p-4 shadow-card">
              <UploadImportDialog portfolioId={selectedId} hasExistingHoldings={portfolio.holdings.length > 0} />
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => refreshPrices.mutate()}
                  disabled={refreshPrices.isPending}
                  className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                  {refreshPrices.isPending ? 'Refreshing…' : 'Refresh Prices'}
                </button>
                {refreshPrices.isError && (
                  <p className="text-xs text-danger">
                    {refreshPrices.error instanceof ApiError ? refreshPrices.error.message : 'Refresh failed.'}
                  </p>
                )}
              </div>
            </div>

            <KpiCards portfolio={portfolio} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Allocation by Sector</h2>
                {/* Chart.js needs an explicitly height-constrained parent to
                    reflow correctly on viewport shrink — without one, the
                    canvas can hold onto a wider desktop-measured size and
                    push the whole page into horizontal scroll until
                    something forces a remount. */}
                <div className="h-64">
                  <AllocationChart holdings={portfolio.holdings} />
                </div>
              </div>
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Gain / Loss by Holding</h2>
                <div className="h-64">
                  <PerformanceChart holdings={portfolio.holdings} />
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-text-primary">Holdings</h2>
              <HoldingsTable holdings={portfolio.holdings} onSymbolClick={setPreviewSymbol} />
            </div>
          </>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </div>
  );
}
