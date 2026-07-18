import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useContrarianScan } from '../api/contrarianFinder';
import { ApiError } from '../api/client';
import ContrarianFinderResultsTable from '../components/ContrarianFinderResultsTable';
import StockPreviewChart from '../components/StockPreviewChart';

export default function ContrarianFinderPage() {
  const scan = useContrarianScan();
  const [threshold, setThreshold] = useState(25);
  const [batchSize, setBatchSize] = useState('');
  const [maxBatches, setMaxBatches] = useState('');
  const [qualityPreset, setQualityPreset] = useState<'standard' | 'relaxed'>('standard');
  const [scanDays, setScanDays] = useState('');
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // The backend scans the universe in batches with a pause between each to
  // respect FMP's rate limits (a few hundred symbols, ~1 batch/minute) — a
  // scan can legitimately take a couple of minutes with no partial results
  // to show in the meantime, so this is purely an expectation-setting timer,
  // not real progress (the API is a single synchronous response, not a
  // polled job).
  useEffect(() => {
    if (!scan.isPending) { setElapsedSeconds(0); return; }
    setElapsedSeconds(0);
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [scan.isPending]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    scan.mutate({
      threshold,
      batchSize: batchSize ? Number(batchSize) : undefined,
      maxBatches: maxBatches ? Number(maxBatches) : undefined,
      qualityPreset,
      scanDays: scanDays ? Number(scanDays) : undefined,
    });
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-4 shadow-card sm:px-6">
        <h1 className="text-lg font-semibold text-text-primary">Contrarian Finder</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Back to dashboard</Link>
      </header>

      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="rounded-card bg-bg-card p-4 shadow-card">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Drop threshold (%)
              <input
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Scan window (days)
              <input
                type="number"
                min={1}
                value={scanDays}
                onChange={(e) => setScanDays(e.target.value)}
                placeholder="default"
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Batch size
              <input
                type="number"
                min={1}
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                placeholder="default"
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Max batches
              <input
                type="number"
                min={1}
                value={maxBatches}
                onChange={(e) => setMaxBatches(e.target.value)}
                placeholder="default"
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="radio"
                name="qualityPreset"
                checked={qualityPreset === 'standard'}
                onChange={() => setQualityPreset('standard')}
              />
              Standard
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="radio"
                name="qualityPreset"
                checked={qualityPreset === 'relaxed'}
                onChange={() => setQualityPreset('relaxed')}
              />
              Relaxed
            </label>

            <button
              type="submit"
              disabled={scan.isPending}
              className="ml-auto rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {scan.isPending ? 'Scanning…' : 'Run scan'}
            </button>
          </div>
        </form>

        {scan.isPending && (
          <div className="flex items-center gap-3 rounded-card bg-bg-card p-4 shadow-card">
            <span className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-border border-t-accent" />
            <div>
              <p className="text-sm font-medium text-text-primary">Scanning the universe… {elapsedSeconds}s</p>
              <p className="text-xs text-text-secondary">
                This runs in rate-limited batches against FMP and can take a couple of minutes — there's no partial progress to show until it finishes.
              </p>
            </div>
          </div>
        )}

        {scan.isError && (
          <p className="text-sm text-danger">
            {scan.error instanceof ApiError ? scan.error.message : 'Scan failed.'}
          </p>
        )}

        {scan.data && (
          <>
            <p className="text-sm text-text-secondary">
              Scanned {scan.data.scanned} of {scan.data.universeSize} tickers · {scan.data.candidates.length} candidates at ≥{scan.data.threshold}% drop
            </p>
            <ContrarianFinderResultsTable results={scan.data.candidates} onSymbolClick={setPreviewSymbol} />
          </>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </div>
  );
}
