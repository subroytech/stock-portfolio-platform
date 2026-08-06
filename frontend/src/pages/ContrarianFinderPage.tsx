import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STRENGTH_LIST_QUERY_KEY, useContrarianBatchScan, useStockUniverse, type ScanResult } from '../api/contrarianFinder';
import { ApiError } from '../api/client';
import { useSession } from '../api/auth';
import { useApiKeysModal } from '../lib/apiKeysModal';
import { formatAsOf } from '../lib/format';
import { useTickerHandoff } from '../lib/tickerHandoff';
import ContrarianFinderResultsTable from '../components/ContrarianFinderResultsTable';
import StrengthListTable from '../components/StrengthListTable';
import StockPreviewChart from '../components/StockPreviewChart';
import StockUniverseTable from '../components/StockUniverseTable';

const WAIT_SECONDS = 62; // matches the wait between batches in api/contrarianFinder.ts

function filterCandidates(results: ScanResult[], threshold: number): ScanResult[] {
  return results
    .filter((r) => !r.filterFail && !r.noData && r.changePct !== undefined && r.changePct <= -threshold)
    .sort((a, b) => (a.changePct as number) - (b.changePct as number));
}

// "dd-mmm" (e.g. "16-Jun") for the scan commentary — changeSinceDate is a
// YYYY-MM-DD trading-day date (see contrarianFinder.service.ts), the same
// for every stock in a scan since they all share the US market calendar.
function formatDdMmm(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${day}-${month}`;
}

export default function ContrarianFinderPage() {
  const scan = useContrarianBatchScan();
  const queryClient = useQueryClient();
  // Real permission check (Admin Console Phase 8), not a hardcoded roles.includes('admin')
  // role-name check - a differently-named role could be granted contrarian_finder:scan
  // without being called "admin". The backend's requirePermission('contrarian_finder:scan')
  // 403 is still the actual enforcement; this just hides the scan form/button entirely
  // (not merely disables them) so a session lacking the permission never sees a control it
  // can't use.
  const { data: session } = useSession();
  const canScan = session?.permissions?.includes('contrarian_finder:scan') ?? false;
  const [threshold, setThreshold] = useState(25);
  const [batchSize, setBatchSize] = useState(125);
  const [maxBatches, setMaxBatches] = useState(5);
  const [scanDays, setScanDays] = useState(7);
  const [qualityPreset, setQualityPreset] = useState<'standard' | 'relaxed'>('standard');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'candidates' | 'strength'>('candidates');
  // Visible to everyone regardless of canScan - read-only reference data, not
  // an action. Collapsed by default; the fetch only fires once expanded.
  const [universeOpen, setUniverseOpen] = useState(false);
  const universe = useStockUniverse(universeOpen);
  // "Run Scan (+ Mkt Cap)" does something extra/unusual (a full m_tickers
  // refresh for every symbol, not just this scan's own results) - a plain
  // click shouldn't fire it immediately, so it's a de-emphasized link that
  // requires an explicit confirm step first, unlike the primary "Run scan" button.
  const [confirmingMktCapScan, setConfirmingMktCapScan] = useState(false);

  const candidates = useMemo(
    () => (scan.data ? filterCandidates(scan.data.results, threshold) : []),
    [scan.data, threshold],
  );
  const strengthList = useMemo(
    () => (scan.data ? scan.data.results.filter((r) => r.strength).sort((a, b) => (b.strength?.kF ?? 0) - (a.strength?.kF ?? 0)) : []),
    [scan.data],
  );
  // Every stock shares the same US market calendar, so the first result
  // that has one tells us the whole scan's comparison anchor date.
  const referenceDate = useMemo(() => {
    const found = scan.data?.results.find((r) => r.changeSinceDate)?.changeSinceDate;
    return found ? formatDdMmm(found) : null;
  }, [scan.data]);

  useEffect(() => {
    if (scan.data) {
      queryClient.setQueryData(STRENGTH_LIST_QUERY_KEY, strengthList);
    }
    // Only re-run when the underlying scan data changes, not on every
    // strengthList recompute (it's derived from scan.data anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.data, queryClient]);

  const missingKeyError = scan.isError && scan.error instanceof ApiError && scan.error.status === 503;
  const apiKeysModal = useApiKeysModal();
  const { launch } = useTickerHandoff();

  return (
    <>
      <main className="flex flex-col gap-6 p-4 sm:p-6">
        {/* Running status commentary - a compact top-of-page line instead of
            a separate full-width card, so it doesn't cost extra vertical
            space while a scan is in flight. */}
        {scan.isPending && (
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-bg-card p-3 shadow-card">
            <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-border border-t-accent" />
            <p className="text-xs text-text-secondary">
              {scan.progress.phase === 'waiting'
                ? `Batch ${scan.progress.currentBatch} of ${scan.progress.totalBatches ?? '?'} done · waiting ${scan.progress.waitRemaining}s (rate-limit buffer)`
                : `Scanning batch ${scan.progress.currentBatch} of ${scan.progress.totalBatches ?? '?'}…`}
            </p>
            {scan.progress.totalBatches != null && (
              <div className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-border">
                <div
                  className="h-1.5 rounded-full bg-accent transition-all"
                  style={{ width: `${Math.round(((scan.progress.currentBatch - 1) / scan.progress.totalBatches) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* "Run Scan (+ Mkt Cap)"'s own separate progress bar - distinct from
            the main scan progress above, since it tracks strictly more work
            (a full m_tickers refresh for every symbol) than a normal scan
            does. Gated by scan.isPending (not just tickerRefreshProgress
            being non-null) - that value is never reset back to null once a
            "+ Mkt Cap" run has happened, so without this gate the spinner
            would keep showing forever after the run actually finished (a
            real bug found live 2026-08-02: the tracker never stopped
            "running" even once results were already on screen). */}
        {scan.isPending && scan.tickerRefreshProgress && (
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-bg-card p-3 shadow-card">
            <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-border border-t-emerald-500" />
            <p className="text-xs text-text-secondary">
              Mkt Cap refresh: {scan.tickerRefreshProgress.completed} of {scan.tickerRefreshProgress.total || '?'} symbols updated
            </p>
            {scan.tickerRefreshProgress.total > 0 && (
              <div className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-border">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((scan.tickerRefreshProgress.completed / scan.tickerRefreshProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Last-run details - the read-only record of what actually produced
            the results currently on screen, independent of the (possibly
            since-edited) live form below. Guarded for sessionStorage data
            persisted by an older build of this page, which predates this field. */}
        {!scan.isPending && scan.data?.params && (
          <p className="text-xs italic text-text-secondary">
            Last scan used: {scan.data.params.threshold}% threshold · {scan.data.params.scanDays}-day window · batch size {scan.data.params.batchSize} · max {scan.data.params.maxBatches} batches · {scan.data.params.qualityPreset === 'relaxed' ? 'Relaxed' : 'Standard'} quality
            {scan.data.completedAt && <> · run {formatAsOf(scan.data.completedAt)}</>}
          </p>
        )}

        <div className="rounded-card bg-bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Drop threshold (%)
              <input
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-28 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>

            {canScan && (
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="rounded-btn bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-500/20"
              >
                ⚙ Advanced {advancedOpen ? '▴' : '▾'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setUniverseOpen((o) => !o)}
              className="rounded-btn bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20"
            >
              📋 Stock Universe ({universe.data ? universe.data.stocks.length : universeOpen ? '…' : '?'} stocks) {universeOpen ? '▴' : '▾'}
            </button>

            {canScan ? (
              <div className="ml-auto flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setConfirmingMktCapScan(false); scan.run({ threshold, batchSize, maxBatches, qualityPreset, scanDays }); }}
                    disabled={scan.isPending}
                    className="rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                  >
                    {scan.isPending ? 'Scanning…' : 'Run scan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingMktCapScan(true)}
                    disabled={scan.isPending}
                    title="Also refreshes name/sector/market cap in m_tickers for every symbol scanned - takes longer than a normal scan"
                    className="text-xs text-emerald-600 underline decoration-dotted hover:text-emerald-700 disabled:opacity-60"
                  >
                    Run Scan (+ Mkt Cap)
                  </button>
                </div>

                {confirmingMktCapScan && (
                  <div className="max-w-xs rounded-btn border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                    <p>
                      ⚠ This also refreshes name/sector/market cap for every symbol scanned — takes
                      longer than a normal scan and isn't something you'd typically need to run.
                    </p>
                    <div className="mt-2 flex justify-end gap-3">
                      <button type="button" onClick={() => setConfirmingMktCapScan(false)} className="text-text-secondary hover:underline">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingMktCapScan(false);
                          scan.run({ threshold, batchSize, maxBatches, qualityPreset, scanDays, updateAllTickerData: true });
                        }}
                        className="font-medium text-amber-700 hover:underline"
                      >
                        Yes, run it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="ml-auto text-xs text-text-secondary">
                Running a new scan requires the &quot;Run Contrarian Finder Scan&quot; permission — contact an admin if you need access.
              </p>
            )}
          </div>

          {canScan && advancedOpen && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                Scan window
                <select
                  value={scanDays}
                  onChange={(e) => setScanDays(Number(e.target.value))}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
                >
                  <option value={7}>7 days</option>
                  <option value={10}>10 days</option>
                  <option value={14}>14 days</option>
                  <option value={21}>21 days</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                Batch size
                <input
                  type="number"
                  min={10}
                  max={250}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-secondary">
                Max batches
                <select
                  value={maxBatches}
                  onChange={(e) => setMaxBatches(Number(e.target.value))}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-sm text-text-secondary">
                Quality
                <div className="flex items-center gap-4 pt-1.5">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="qualityPreset" checked={qualityPreset === 'standard'} onChange={() => setQualityPreset('standard')} />
                    Standard ($10 · $5B)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="qualityPreset" checked={qualityPreset === 'relaxed'} onChange={() => setQualityPreset('relaxed')} />
                    Relaxed ($5 · $2.5B)
                  </label>
                </div>
              </div>
            </div>
          )}

          {universeOpen && (
            <div className="mt-4 border-t border-border pt-4">
              {universe.isPending && <p className="text-sm text-text-secondary">Loading…</p>}
              {universe.isError && <p className="text-sm text-danger">Failed to load the stock universe.</p>}
              {universe.data && <StockUniverseTable data={universe.data} />}
            </div>
          )}
        </div>

        {canScan && !scan.data && !scan.isPending && !scan.isError && (
          <div className="rounded-card bg-bg-card p-4 shadow-card text-sm text-text-secondary">
            <p>
              Scans up to 600 stocks across the Dow 30, Nasdaq-100, S&amp;P 500 Top 400, and 11
              sector ETFs, one batch of FMP calls at a time, with a real ~{WAIT_SECONDS}s pause
              between batches to stay within rate limits — a full scan can take a couple of minutes.
            </p>
            <p className="mt-2">Requires an FMP API key on file — <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">add one under API Keys</button>.</p>
          </div>
        )}

        {!canScan && !scan.data && (
          <div className="rounded-card bg-bg-card p-4 shadow-card text-sm text-text-secondary">
            <p>No scan results yet. Once someone with access runs a scan, results will appear here for you to filter and browse.</p>
          </div>
        )}

        {scan.isError && (
          <div className="text-sm text-danger">
            <p>{scan.error instanceof ApiError ? scan.error.message : 'Scan failed.'}</p>
            {missingKeyError && (
              <p className="mt-1">
                <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">Add your FMP API key</button> to run a scan.
              </p>
            )}
          </div>
        )}

        {scan.data && (
          <>
            <p className="text-sm text-text-secondary">
              Scanned {scan.data.scanned} of {scan.data.universeSize} tickers · {candidates.length} candidates at ≥{threshold}% drop
              {referenceDate && <> · considering price since {referenceDate}</>}
            </p>

            <div className="flex gap-4 border-b border-border">
              <button
                type="button"
                onClick={() => setActiveTab('candidates')}
                className={`border-b-2 px-1 pb-2 text-sm font-medium ${activeTab === 'candidates' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'}`}
              >
                Candidates ({candidates.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('strength')}
                className={`border-b-2 px-1 pb-2 text-sm font-medium ${activeTab === 'strength' ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'}`}
              >
                Strength List ({strengthList.length})
              </button>
            </div>

            {activeTab === 'candidates' ? (
              <ContrarianFinderResultsTable
                results={candidates}
                onSymbolClick={setPreviewSymbol}
                onLongTermAnalysis={(symbol) => launch('long-term-analysis', symbol)}
                onContrarianComeback={(symbol) => launch('contrarian-comeback', symbol)}
              />
            ) : (
              <StrengthListTable
                results={strengthList}
                onSymbolClick={setPreviewSymbol}
                onLongTermAnalysis={(symbol) => launch('long-term-analysis', symbol)}
              />
            )}
          </>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </>
  );
}
