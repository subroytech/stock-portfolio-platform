import { useTickerDataDeltaUpdate } from '../api/contrarianFinder';
import { ApiError } from '../api/client';
import { useApiKeysModal } from '../lib/apiKeysModal';

// Admin Console "Master Data" tab (next to "My API(s)") - the lighter,
// missing-only sibling of Contrarian Finder's "Run Scan (+ Mkt Cap)". Lets
// an Admin/Admin-Master patch m_tickers gaps (a symbol with no row, or a
// null name/sector/market_cap) from time to time without needing to run a
// full scan - see contrarianFinder.service.ts's refreshTickerDataBatch()
// ('missing' mode) for the shared logic both features call into.
export default function MasterDataPage() {
  const deltaUpdate = useTickerDataDeltaUpdate();
  const apiKeysModal = useApiKeysModal();
  const missingKeyError = deltaUpdate.isError && deltaUpdate.error instanceof ApiError && deltaUpdate.error.status === 503;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card bg-bg-card p-4 shadow-card">
        <p className="font-medium text-text-primary">Ticker Data Delta Update</p>
        <p className="mt-1 text-sm text-text-secondary">
          Fetches name/sector/market cap from FMP for any scan-universe symbol m_tickers is
          missing data for (a symbol with no row at all, or a null field) - already-complete
          symbols are skipped. Safe to run repeatedly.
        </p>

        <button
          type="button"
          onClick={() => deltaUpdate.run()}
          disabled={deltaUpdate.isPending}
          className="mt-3 rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {deltaUpdate.isPending ? 'Running…' : 'Run Delta Update'}
        </button>

        {deltaUpdate.isPending && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-border border-t-accent" />
            <p className="text-xs text-text-secondary">
              {deltaUpdate.progress.phase === 'waiting'
                ? `Batch ${deltaUpdate.progress.currentBatch} of ${deltaUpdate.progress.totalBatches ?? '?'} done · waiting ${deltaUpdate.progress.waitRemaining}s (rate-limit buffer)`
                : `Batch ${deltaUpdate.progress.currentBatch} of ${deltaUpdate.progress.totalBatches ?? '?'}…`}
            </p>
            {deltaUpdate.progress.totalBatches != null && (
              <div className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-border">
                <div
                  className="h-1.5 rounded-full bg-accent transition-all"
                  style={{ width: `${Math.round(((deltaUpdate.progress.currentBatch - 1) / deltaUpdate.progress.totalBatches) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {deltaUpdate.isError && (
          <div className="mt-3 text-sm text-danger">
            <p>{deltaUpdate.error instanceof ApiError ? deltaUpdate.error.message : 'Delta update failed.'}</p>
            {missingKeyError && (
              <p className="mt-1">
                <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">Add your FMP API key</button> to run this.
              </p>
            )}
          </div>
        )}

        {deltaUpdate.result && !deltaUpdate.isPending && (
          <p className="mt-3 text-sm text-text-secondary">
            Updated {deltaUpdate.result.updated} of {deltaUpdate.result.universeSize} symbols
            ({deltaUpdate.result.skipped} already complete).
          </p>
        )}
      </div>
    </div>
  );
}
