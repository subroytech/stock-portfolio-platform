import { useState } from 'react';
import { usePortfolio, useRefreshPrices } from '../api/portfolios';
import type { RefreshPricesResult, PortfolioSummary } from '../api/portfolios';
import { ApiError } from '../api/client';
import { formatAsOf } from '../lib/format';
import PortfolioSelector from '../components/PortfolioSelector';
import UploadImportDialog from '../components/UploadImportDialog';
import KpiCards from '../components/KpiCards';
import AllocationChart, { AllocationModeToggle } from '../components/AllocationChart';
import type { AllocationMode } from '../components/AllocationChart';
import PerformanceChart from '../components/PerformanceChart';
import HoldingsTable from '../components/HoldingsTable';
import StockPreviewChart from '../components/StockPreviewChart';

interface DashboardPageProps {
  // Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section) - the Legacy
  // sub-tab's defensive-default fallback for a session with neither portfolio_upload:legacy
  // nor portfolio_upload:flex (TabShell.tsx, Phase 4): view-only, no UploadImportDialog. Every
  // pre-existing caller omits this (defaults to false), so today's behavior is unchanged.
  readOnly?: boolean;
  // Portfolio Upload - Flex - passed through to PortfolioSelector unchanged. TabShell's
  // Legacy sub-tab uses this to hide Flex-created portfolios from this view entirely.
  portfolioFilter?: (p: PortfolioSummary) => boolean;
}

export default function DashboardPage({ readOnly = false, portfolioFilter }: DashboardPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('todayDollar');
  const { data: portfolio, isLoading } = usePortfolio(selectedId);
  const refreshPrices = useRefreshPrices(selectedId ?? '');

  // Keyed by portfolio ID, not the mutation's own single `.data` slot -
  // DashboardPage never unmounts when switching portfolios via the
  // PortfolioSelector pills (just a selectedId change), so a single un-keyed
  // `refreshPrices.data` would leak one portfolio's period-return history
  // into another's view whenever their symbols happened to overlap. Only
  // the period-tabs (performanceHistory) need this - Today's-$ is DB-backed
  // (todayChangeDollar on `portfolio.holdings` itself, see AllocationChart/
  // PerformanceChart) and doesn't have this problem.
  const [resultsByPortfolio, setResultsByPortfolio] = useState<Record<string, RefreshPricesResult>>({});
  const refreshResult = selectedId ? resultsByPortfolio[selectedId] : undefined;

  const handleRefresh = () => {
    if (!selectedId) return;
    const portfolioId = selectedId;
    refreshPrices.mutate(undefined, {
      onSuccess: (result) => setResultsByPortfolio((prev) => ({ ...prev, [portfolioId]: result })),
    });
  };

  // The oldest price_updated_at across holdings, not the newest - same
  // honesty principle as refreshPrices() itself: a holding that didn't get
  // a fresh quote keeps its old timestamp, so the aggregate "as of" banner
  // shouldn't overclaim freshness for a partially-succeeded refresh.
  const oldestPriceUpdate = portfolio
    ? portfolio.holdings.map((h) => h.priceUpdatedAt).filter((t): t is string => t != null).sort()[0] ?? null
    : null;

  return (
    <>
      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <PortfolioSelector selectedId={selectedId} onSelect={setSelectedId} filter={portfolioFilter} />

        {!selectedId && (
          <p className="text-sm text-text-secondary">Select or create a portfolio to get started.</p>
        )}

        {selectedId && isLoading && <p className="text-sm text-text-secondary">Loading portfolio…</p>}

        {selectedId && portfolio && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bg-card p-4 shadow-card">
              {readOnly ? <span /> : <UploadImportDialog portfolioId={selectedId} hasExistingHoldings={portfolio.holdings.length > 0} />}
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={handleRefresh}
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
                {oldestPriceUpdate && (
                  <p className="text-xs text-text-muted">Prices as of {formatAsOf(oldestPriceUpdate)}</p>
                )}
              </div>
            </div>

            <KpiCards portfolio={portfolio} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">Allocation</h2>
                  <AllocationModeToggle mode={allocationMode} onChange={setAllocationMode} />
                </div>
                {/* Fixed, not min - this is the reference height every mode
                    (Sector/Stock/Today's $) fills via AllocationChart's
                    PieBox, so the card's vertical size stays constant when
                    switching modes instead of jumping around. */}
                <div className="h-96">
                  <AllocationChart holdings={portfolio.holdings} mode={allocationMode} />
                </div>
              </div>
              {/* flex column so the Performance card - stretched by the grid
                  row to match Allocation's fixed h-96 above - passes that
                  extra height down into the chart itself (flex-1) instead of
                  leaving it as blank space below a short, fixed-height chart. */}
              <div className="flex flex-col rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 shrink-0 text-sm font-semibold text-text-primary">Performance</h2>
                <div className="min-h-0 flex-1">
                  <PerformanceChart holdings={portfolio.holdings} refreshResult={refreshResult} />
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
    </>
  );
}
