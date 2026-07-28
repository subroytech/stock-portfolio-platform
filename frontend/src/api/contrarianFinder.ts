import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface StrengthSignal {
  rsi: number;
  sma20: number;
  sma50: number;
  rr: number;
  kF: number;
  halfKelly: number;
}

export interface ScanResult {
  symbol: string;
  filterFail: boolean;
  noData?: boolean;
  error?: string;
  name?: string;
  sector?: string;
  price?: number;
  mktCap?: number;
  volume?: number;
  avgVol?: number;
  changePct?: number;
  changeSinceDate?: string; // the actual trading-day date changePct is measured from (YYYY-MM-DD)
  mktClosed?: boolean;
  strength?: StrengthSignal | null;
  source?: string;
}

export interface BatchScanInput {
  threshold: number;
  batchSize?: number;
  maxBatches?: number;
  qualityPreset?: 'standard' | 'relaxed';
  scanDays?: number;
}

interface BatchScanResponse {
  batchIndex: number;
  totalBatches: number;
  universeSize: number;
  results: ScanResult[];
}

// The parameters a scan actually ran with — captured once when the scan
// starts and never touched again, so it stays a true historical record even
// if the user keeps adjusting the (still-editable) form controls afterward
// without re-running. Threshold is included even though it's never sent to
// the backend (filtering happens client-side) - it's still a parameter the
// user "overrode" for that run, so it belongs in the same read-only record.
export interface RunParams {
  threshold: number;
  batchSize: number;
  maxBatches: number;
  qualityPreset: 'standard' | 'relaxed';
  scanDays: number;
}

export interface BatchScanData {
  universeSize: number;
  scanned: number;
  results: ScanResult[];
  params: RunParams;
}

export type BatchScanPhase = 'idle' | 'scanning' | 'waiting' | 'done';

export interface BatchScanProgress {
  phase: BatchScanPhase;
  currentBatch: number; // 1-indexed, for display
  totalBatches: number | null; // unknown until the first batch response arrives
  waitRemaining: number; // seconds left in the current inter-batch wait, 0 otherwise
}

// Real (not estimated) rate-limit pacing between batch requests — the
// frontend now orchestrates the scan itself (see contrarianFinder.service.ts's
// header comment for why), one HTTP request per batch, instead of the
// backend holding one request open for the whole scan. Same 62s figure the
// backend used to sleep() server-side. 0 under Vitest so tests don't need to
// juggle fake timers against userEvent/React's act() to exercise the
// multi-batch loop — same test-only-override trick the old backend
// runScan()'s injectable waitSeconds used before batching moved client-side.
const WAIT_SECONDS = import.meta.env.MODE === 'test' ? 0 : 62;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Counts down `seconds` in 1s ticks via onTick, resolving early if
// isCancelled() ever becomes true (component unmounted / a new scan started).
async function waitWithCountdown(seconds: number, onTick: (remaining: number) => void, isCancelled: () => boolean): Promise<void> {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    if (isCancelled()) return;
    onTick(remaining);
    await sleep(1000);
  }
  if (!isCancelled()) onTick(0);
}

// Shared cache slot for the last (in-progress or completed) scan's
// aggregated data — written on every batch update, read as this hook's
// lazy initial state, so navigating away from ContrarianFinderPage and back
// (a remount, which would otherwise reset plain useState to nothing) still
// shows the last scan's results instead of an empty page. Same mechanism
// STRENGTH_LIST_QUERY_KEY already uses to survive a Momentum-page visit,
// just also covering "leave and come back to this same page."
export const LAST_SCAN_QUERY_KEY = ['contrarianFinder', 'lastScan'] as const;

// sessionStorage backs the same data so it also survives a full page
// refresh (a reload creates a brand new QueryClient, wiping the cache
// above) — but not a closed tab/browser restart, so stale multi-day-old
// scan data doesn't linger indefinitely the way localStorage would. Only a
// fresh "Run scan" (which clears both) or the tab actually closing ever
// resets this; changing the decline threshold never touches it, since
// filtering happens client-side against whatever `results` is already held.
const LAST_SCAN_STORAGE_KEY = 'contrarianFinder:lastScan';

function readPersistedScanData(): BatchScanData | undefined {
  try {
    const raw = sessionStorage.getItem(LAST_SCAN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BatchScanData) : undefined;
  } catch {
    return undefined; // private-browsing storage quota, corrupt JSON, etc. - just skip restoring
  }
}

function persistScanData(data: BatchScanData | undefined): void {
  try {
    if (data) sessionStorage.setItem(LAST_SCAN_STORAGE_KEY, JSON.stringify(data));
    else sessionStorage.removeItem(LAST_SCAN_STORAGE_KEY);
  } catch {
    // non-fatal - the in-memory QueryClient cache still works for same-tab navigation
  }
}

// Orchestrates a full Contrarian Finder scan as a sequence of per-batch
// requests (POST /contrarian-finder/scan-batch), rather than one long-held
// request. Stops the moment the server-reported `totalBatches` is reached —
// never fires a request for a batch beyond what the real universe/batchSize
// combination actually produces, even if the user asked for more batches
// than that. Paces itself between requests with a real (not estimated)
// countdown, giving genuine batch-by-batch progress.
export function useContrarianBatchScan() {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Lazy-initialized from the shared cache (survives same-tab navigation)
  // falling back to sessionStorage (survives a full page refresh too), so a
  // remount picks up right where the last scan left off instead of blanking.
  const [data, setDataState] = useState<BatchScanData | undefined>(
    () => queryClient.getQueryData<BatchScanData>(LAST_SCAN_QUERY_KEY) ?? readPersistedScanData(),
  );
  const [progress, setProgress] = useState<BatchScanProgress>({
    phase: 'idle', currentBatch: 0, totalBatches: null, waitRemaining: 0,
  });

  const setData = useCallback((next: BatchScanData | undefined) => {
    setDataState(next);
    queryClient.setQueryData(LAST_SCAN_QUERY_KEY, next);
    persistScanData(next);
  }, [queryClient]);

  // Bumped on every run() call / unmount so an in-flight loop from a
  // previous (or abandoned) run stops touching state after the fact.
  const runIdRef = useRef(0);

  useEffect(() => () => { runIdRef.current += 1; }, []);

  const run = useCallback(async (input: BatchScanInput) => {
    const myRunId = (runIdRef.current += 1);
    const isCancelled = () => runIdRef.current !== myRunId;

    // threshold isn't part of the wire request (filtering is client-side),
    // so it's split off here: wireInput goes over the network, params (which
    // includes it) becomes the persisted read-only record of this run.
    const { threshold, ...wireInput } = input;
    const params: RunParams = {
      threshold,
      batchSize: wireInput.batchSize ?? 125,
      maxBatches: wireInput.maxBatches ?? 3,
      qualityPreset: wireInput.qualityPreset ?? 'standard',
      scanDays: wireInput.scanDays ?? 7,
    };

    setIsPending(true);
    setIsError(false);
    setError(null);
    setData(undefined);
    setProgress({ phase: 'scanning', currentBatch: 1, totalBatches: null, waitRemaining: 0 });

    const allResults: ScanResult[] = [];
    let totalBatches = Infinity; // unknown until the first response tells us
    let batchIndex = 0;

    try {
      while (batchIndex < totalBatches) {
        if (isCancelled()) return;
        setProgress((p) => ({ ...p, phase: 'scanning', currentBatch: batchIndex + 1 }));

        const res = await apiFetch<BatchScanResponse>('/contrarian-finder/scan-batch', {
          method: 'POST',
          body: JSON.stringify({ ...wireInput, batchIndex }),
        });
        if (isCancelled()) return;

        totalBatches = res.totalBatches;
        allResults.push(...res.results);
        setData({ universeSize: res.universeSize, scanned: allResults.length, results: [...allResults], params });
        setProgress((p) => ({ ...p, totalBatches, currentBatch: batchIndex + 1 }));

        batchIndex += 1;
        if (batchIndex < totalBatches) {
          setProgress((p) => ({ ...p, phase: 'waiting' }));
          await waitWithCountdown(
            WAIT_SECONDS,
            (remaining) => setProgress((p) => ({ ...p, waitRemaining: remaining })),
            isCancelled,
          );
        }
      }
      if (!isCancelled()) setProgress((p) => ({ ...p, phase: 'done', waitRemaining: 0 }));
    } catch (err) {
      if (!isCancelled()) { setIsError(true); setError(err); }
    } finally {
      if (!isCancelled()) setIsPending(false);
    }
  }, [setData]);

  return { run, isPending, isError, error, data, progress };
}

// Shared cache slot for the last scan's Strength List — ContrarianFinderPage
// writes into this via queryClient.setQueryData() after a successful scan;
// MomentumPage reads it passively via useStrengthListCache() so it can show
// the same table if a scan has already run this session (matching the
// source app's cross-widget window.cfStrengthList placement, adapted to
// TanStack Query's cache instead of a global browser variable).
export const STRENGTH_LIST_QUERY_KEY = ['contrarianFinder', 'strengthList'] as const;

export function useStrengthListCache() {
  return useQuery<ScanResult[]>({
    queryKey: STRENGTH_LIST_QUERY_KEY,
    queryFn: () => Promise.resolve([]),
    enabled: false,
  });
}
