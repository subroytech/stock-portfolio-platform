import { useRunHistoryList, type RunHistoryListItem } from '../api/contrarianFinder';
import { formatAsOf } from '../lib/format';

interface ContrarianRunHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRun: (run: RunHistoryListItem) => void;
}

// Contrarian Finder — Run History (2026-08-31). A right-side slide-over, not
// a centered modal like TabShell.tsx's API Keys dialog - browsing a list of
// past runs while still being able to see (and use) the live page behind it
// is the whole point ("without disturbing the current default view," the
// user's own explicit requirement). Same backdrop-click-to-close mechanics
// as every other overlay in this app, just positioned right-0/h-full/
// translate-x instead of centered.
//
// Only ever rendered for a session with contrarian_finder:view_history -
// ContrarianFinderPage.tsx hides the entry point entirely without it, and
// the backend 403s the underlying GETs regardless, so this component itself
// doesn't need its own permission check.
export default function ContrarianRunHistoryDrawer({ isOpen, onClose, onSelectRun }: ContrarianRunHistoryDrawerProps) {
  // enabled: only fetched while actually open - reopening after the first
  // time reuses TanStack's own cache rather than re-fetching every time.
  const history = useRunHistoryList(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} data-testid="run-history-backdrop">
      <div
        className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col bg-bg-card shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Run History"
        data-testid="run-history-drawer"
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-base font-semibold text-text-primary">Run History</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="run-history-close"
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {history.isLoading && <p className="p-4 text-sm text-text-secondary">Loading…</p>}
          {history.isError && <p className="p-4 text-sm text-danger">Could not load run history.</p>}
          {history.data && history.data.runs.length === 0 && (
            <p className="p-4 text-sm text-text-secondary" data-testid="run-history-empty">
              No older runs yet — once more scans are run, they&apos;ll show up here.
            </p>
          )}
          {history.data?.runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelectRun(run)}
              data-testid={`run-history-row-${run.id}`}
              className="block w-full border-b border-border px-4 py-3 text-left hover:bg-bg-primary"
            >
              <p className="text-sm font-medium text-text-primary">{formatAsOf(run.completedAt)}</p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {run.params.threshold}% Threshold - {run.params.scanDays} Day Window
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
