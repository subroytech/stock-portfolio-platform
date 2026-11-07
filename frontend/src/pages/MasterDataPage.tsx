import { useState } from 'react';
import {
  useTickerDataDeltaUpdate, useHeldSymbolSyncPreview, useHeldSymbolSync,
} from '../api/contrarianFinder';
import type { SyncHeldSymbolsResult } from '../api/contrarianFinder';
import { ApiError } from '../api/client';
import { useApiKeysModal } from '../lib/apiKeysModal';

const RESULT_BUCKETS: { key: keyof SyncHeldSymbolsResult; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'alreadyInUniverse', label: 'Already in Universe' },
  { key: 'excludedAsEtf', label: 'Excluded — ETF' },
  { key: 'excludedAsCrypto', label: 'Excluded — Crypto' },
  { key: 'validationFailed', label: 'Could Not Validate' },
  { key: 'capExceeded', label: 'Cap Reached' },
];

function SyncResultBuckets({ result }: { result: SyncHeldSymbolsResult }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {RESULT_BUCKETS.map(({ key, label }) => {
        const symbols = result[key];
        return (
          <details key={key} className="rounded-md border border-border px-2.5 py-1.5">
            <summary className="cursor-pointer text-sm font-medium text-text-primary">
              {label} ({symbols.length})
            </summary>
            {symbols.length > 0 && <p className="mt-1 text-xs text-text-secondary">{symbols.join(', ')}</p>}
          </details>
        );
      })}
    </div>
  );
}

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

  // Sync Portfolio-Held Tickers (2026-11-06) - preview-then-confirm, not "just run it": this is
  // new code, spends real FMP quota, and writes to m_index_constituent for the first time ever
  // outside the one-time seed, so a look-before-you-commit step is worth the extra click.
  const [previewRequested, setPreviewRequested] = useState(false);
  const preview = useHeldSymbolSyncPreview(previewRequested);
  const heldSync = useHeldSymbolSync();
  const heldSyncMissingKeyError = heldSync.isError && heldSync.error instanceof ApiError && heldSync.error.status === 503;

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

      <div className="rounded-card bg-bg-card p-4 shadow-card">
        <p className="font-medium text-text-primary">Sync Portfolio-Held Tickers</p>
        <p className="mt-1 text-sm text-text-secondary">
          Finds symbols held in a user portfolio that aren&apos;t in the Contrarian Finder scan
          universe yet (or whose m_tickers data is still incomplete), validates each one live via
          FMP, and adds genuine stocks under a new &quot;USER_HELD&quot; index. ETFs and crypto are
          identified and excluded from the scan universe, but still get their name/sector/market
          cap filled in either way, since Portfolio&apos;s own sector display relies on it too.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPreviewRequested(true)}
            disabled={preview.isFetching}
            className="rounded-btn bg-bg px-4 py-1.5 text-sm font-medium text-text-primary ring-1 ring-border transition-colors hover:bg-border disabled:opacity-60"
          >
            {preview.isFetching ? 'Checking…' : 'Check for Gaps'}
          </button>
          <button
            type="button"
            onClick={() => heldSync.run()}
            disabled={!preview.data || preview.data.candidates.length === 0 || heldSync.isPending}
            className="rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {heldSync.isPending ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>

        {previewRequested && preview.data && (
          <p className="mt-3 text-sm text-text-secondary">
            {preview.data.candidates.length === 0
              ? 'No gaps found - every held symbol is already in the universe with complete data.'
              : `${preview.data.candidates.length} held symbol(s) need attention: ${preview.data.candidates.map((c) => c.symbol).join(', ')}.`}
          </p>
        )}

        {heldSync.isError && (
          <div className="mt-3 text-sm text-danger">
            <p>{heldSync.error instanceof ApiError ? heldSync.error.message : 'Sync failed.'}</p>
            {heldSyncMissingKeyError && (
              <p className="mt-1">
                <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">Add your FMP API key</button> to run this.
              </p>
            )}
          </div>
        )}

        {heldSync.result && !heldSync.isPending && <SyncResultBuckets result={heldSync.result} />}
      </div>
    </div>
  );
}
