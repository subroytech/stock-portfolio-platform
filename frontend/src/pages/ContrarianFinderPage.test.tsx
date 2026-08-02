import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import ContrarianFinderPage from './ContrarianFinderPage';
import type { ScanResult } from '../api/contrarianFinder';

const ADMIN_SESSION = { id: '1', email: 'admin@example.com', roles: ['user', 'admin'], permissions: ['contrarian_finder:scan'] };

// Every test below is about the scan flow itself, not the permission gate (which
// has its own dedicated test) - pre-seeding ['session'] means useSession()
// reads straight from the query cache instead of calling apiFetch('/auth/me'),
// so it never interferes with these tests' own apiFetch mocks (which are all
// scoped to /contrarian-finder/scan-batch).
function renderPage(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  session: { roles: string[]; permissions?: string[] } | null = ADMIN_SESSION,
) {
  queryClient.setQueryData(['session'], session);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContrarianFinderPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function scanResult(overrides: Partial<ScanResult>): ScanResult {
  return { symbol: 'AAA', filterFail: false, noData: false, ...overrides };
}

// A single-batch response (totalBatches: 1) — no inter-batch wait occurs, so
// most tests don't need fake timers at all. The dedicated
// "orchestrates multiple batches" test below covers the 2-batch/wait path.
function singleBatchResponse() {
  const results: ScanResult[] = [
    scanResult({ symbol: 'AAA', changePct: -30, name: 'Alpha Co', changeSinceDate: '2026-06-16' }),
    scanResult({ symbol: 'BBB', changePct: -10, name: 'Beta Co' }), // below default 25% threshold
    scanResult({
      symbol: 'CCC', changePct: 3, name: 'Charlie Co',
      strength: { rsi: 60, sma20: 100, sma50: 95, rr: 2, kF: 0.3, halfKelly: 0.15 },
    }),
  ];
  return { batchIndex: 0, totalBatches: 1, universeSize: 3, results };
}

describe('ContrarianFinderPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('a session lacking contrarian_finder:scan sees the drop-threshold filter but not Run scan/Advanced, and an access message shows instead', async () => {
    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }), { roles: ['user'], permissions: [] });

    expect(screen.queryByRole('button', { name: 'Run scan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advanced/i })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /drop threshold/i })).toBeInTheDocument();
    expect(screen.getByText(/requires the "Run Contrarian Finder Scan" permission/i)).toBeInTheDocument();
    expect(apiFetchSpy).not.toHaveBeenCalled();
  });

  test('the scan form is not rendered when there is no session at all (defensive default, not just missing the permission)', () => {
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }), null);
    expect(screen.queryByRole('button', { name: 'Run scan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advanced/i })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /drop threshold/i })).toBeInTheDocument();
  });

  test('a session lacking contrarian_finder:scan can still filter and browse an already-persisted scan result, without triggering a new one', async () => {
    sessionStorage.setItem('contrarianFinder:lastScan', JSON.stringify({
      universeSize: 999, scanned: 1, results: [scanResult({ symbol: 'AAA', changePct: -30 }), scanResult({ symbol: 'BBB', changePct: -10 })],
    }));
    const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }), { roles: ['user'], permissions: [] });

    expect(screen.queryByRole('button', { name: 'Run scan' })).not.toBeInTheDocument();
    expect(screen.getByText('Candidates (1)')).toBeInTheDocument(); // only AAA (-30%) clears the default 25% threshold
    expect(apiFetchSpy).not.toHaveBeenCalled();

    const thresholdInput = screen.getByRole('spinbutton', { name: /drop threshold/i });
    await userEvent.clear(thresholdInput);
    await userEvent.type(thresholdInput, '5');
    await waitFor(() => expect(screen.getByText('Candidates (2)')).toBeInTheDocument()); // AAA + BBB now clear 5%
    expect(apiFetchSpy).not.toHaveBeenCalled(); // still no network call - purely client-side re-filter
  });

  test('shows the idle explainer with a button to open the API Keys modal before any scan runs', () => {
    renderPage();
    expect(screen.getByText(/Scans up to 450 stocks/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add one under api keys/i })).toBeInTheDocument();
  });

  test('Advanced panel is collapsed by default, showing the confirmed defaults once opened', async () => {
    renderPage();
    expect(screen.queryByText('Scan window')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Advanced/i }));
    expect(screen.getByText('Scan window')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scan window' })).toHaveValue('7');
    expect(screen.getByRole('spinbutton', { name: 'Batch size' })).toHaveValue(125);
    expect(screen.getByRole('combobox', { name: 'Max batches' })).toHaveValue('3');
  });

  test('submitting scans batch 0 with the confirmed defaults', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/contrarian-finder/scan-batch', {
      method: 'POST',
      body: JSON.stringify({ batchSize: 125, maxBatches: 3, qualityPreset: 'standard', scanDays: 7, batchIndex: 0 }),
    }));
  });

  test('shows client-filtered candidates and re-filters instantly on threshold change with no new request', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByText('Candidates (1)')).toBeInTheDocument(); // only AAA (-30%) clears 25%
    expect(client.apiFetch).toHaveBeenCalledTimes(1);

    await userEvent.clear(screen.getByRole('spinbutton', { name: /drop threshold/i }));
    await userEvent.type(screen.getByRole('spinbutton', { name: /drop threshold/i }), '5');

    await waitFor(() => expect(screen.getByText('Candidates (2)')).toBeInTheDocument()); // AAA + BBB now clear 5%
    expect(client.apiFetch).toHaveBeenCalledTimes(1); // still no re-scan
  });

  test('summary line shows the trading-day date the scan compares prices against', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByText(/considering price since 16-Jun/)).toBeInTheDocument();
  });

  test('Strength List tab shows strength-tagged stocks regardless of decline threshold', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await screen.findByText('Candidates (1)');

    await userEvent.click(screen.getByRole('button', { name: /Strength List/i }));
    expect(screen.getAllByText('CCC').length).toBeGreaterThan(0);
  });

  test('shows the last scan\'s actual parameters as read-only info, unaffected by later (unapplied) form edits', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await screen.findByText('Candidates (1)');

    expect(screen.getByText(
      'Last scan used: 25% threshold · 7-day window · batch size 125 · max 3 batches · Standard quality',
    )).toBeInTheDocument();

    // Change the live threshold and an Advanced field without re-running -
    // the read-only line must keep reflecting what actually produced these results.
    await userEvent.clear(screen.getByRole('spinbutton', { name: /drop threshold/i }));
    await userEvent.type(screen.getByRole('spinbutton', { name: /drop threshold/i }), '5');
    await userEvent.click(screen.getByRole('button', { name: /Advanced/i }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Scan window' }), '14');

    expect(screen.getByText(
      'Last scan used: 25% threshold · 7-day window · batch size 125 · max 3 batches · Standard quality',
    )).toBeInTheDocument();
  });

  test('retained scan parameters survive navigating away and back, and a full page refresh', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    const first = renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await screen.findByText('Candidates (1)');

    first.unmount();
    const second = renderPage(first.queryClient); // same-tab nav
    expect(screen.getByText(/Last scan used: 25% threshold/)).toBeInTheDocument();

    second.unmount();
    renderPage(); // fresh QueryClient - simulates a full page reload, sessionStorage intact
    expect(screen.getByText(/Last scan used: 25% threshold/)).toBeInTheDocument();
  });

  test('does not crash on pre-existing persisted scan data that predates the retained-parameters field', () => {
    sessionStorage.setItem('contrarianFinder:lastScan', JSON.stringify({
      universeSize: 999, scanned: 1, results: [scanResult({ symbol: 'STALE', changePct: -99 })],
    }));
    renderPage();
    expect(screen.getByText('Candidates (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Last scan used:/)).not.toBeInTheDocument();
  });

  test('missing FMP key shows a 503 message with a button to add one', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(503, 'No fmp API key on file.', null));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    expect(await screen.findByText('No fmp API key on file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your fmp api key/i })).toBeInTheDocument();
  });

  test('orchestrates multiple batches sequentially and stops at the real totalBatches, not the requested max', async () => {
    // The inter-batch wait is 0 under Vitest (see WAIT_SECONDS in
    // api/contrarianFinder.ts), so this exercises the real multi-batch loop
    // without needing fake timers.
    const batch0 = { batchIndex: 0, totalBatches: 2, universeSize: 6, results: [scanResult({ symbol: 'AAA', changePct: -30 })] };
    const batch1 = { batchIndex: 1, totalBatches: 2, universeSize: 6, results: [scanResult({ symbol: 'BBB', changePct: -30 })] };
    const apiFetchSpy = vi.spyOn(client, 'apiFetch')
      .mockResolvedValueOnce(batch0)
      .mockResolvedValueOnce(batch1);

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    await waitFor(() => expect(apiFetchSpy).toHaveBeenCalledTimes(2));
    expect(apiFetchSpy).toHaveBeenNthCalledWith(1, '/contrarian-finder/scan-batch', {
      method: 'POST',
      body: JSON.stringify({ batchSize: 125, maxBatches: 3, qualityPreset: 'standard', scanDays: 7, batchIndex: 0 }),
    });
    expect(apiFetchSpy).toHaveBeenNthCalledWith(2, '/contrarian-finder/scan-batch', {
      method: 'POST',
      body: JSON.stringify({ batchSize: 125, maxBatches: 3, qualityPreset: 'standard', scanDays: 7, batchIndex: 1 }),
    });

    // AAA + BBB, both -30%. Never attempted a 3rd batch, even though the
    // requested maxBatches was 3 - the server-reported totalBatches (2) is
    // authoritative.
    await waitFor(() => expect(screen.getByText('Candidates (2)')).toBeInTheDocument());
    expect(apiFetchSpy).toHaveBeenCalledTimes(2);
  });

  test('scan results survive navigating away and back (same QueryClient, page unmounted/remounted)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    const { unmount, queryClient } = renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await screen.findByText('Candidates (1)');

    unmount(); // simulates navigating to the dashboard - the QueryClient itself outlives this
    renderPage(queryClient); // simulates navigating back to /contrarian-finder

    expect(screen.getByText('Candidates (1)')).toBeInTheDocument(); // shown immediately, no re-scan
    expect(client.apiFetch).toHaveBeenCalledTimes(1);
  });

  test('scan results survive a full page refresh (fresh QueryClient, sessionStorage intact)', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    const { unmount } = renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await screen.findByText('Candidates (1)');

    unmount();
    renderPage(); // a brand new QueryClient - simulates a real page reload

    expect(screen.getByText('Candidates (1)')).toBeInTheDocument(); // restored from sessionStorage, no re-scan
    expect(client.apiFetch).toHaveBeenCalledTimes(1);
  });

  test('running a fresh scan replaces the persisted results, not merges with them', async () => {
    sessionStorage.setItem('contrarianFinder:lastScan', JSON.stringify({
      universeSize: 999, scanned: 1, results: [scanResult({ symbol: 'STALE', changePct: -99 })],
    }));
    vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
    renderPage();

    expect(screen.getByText('Candidates (1)')).toBeInTheDocument(); // the stale persisted result, shown on mount
    expect(screen.getAllByText('STALE').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(screen.queryByText('STALE')).not.toBeInTheDocument());
    expect(screen.getAllByText('AAA').length).toBeGreaterThan(0);
  });

  describe('Stock Universe section', () => {
    const fakeUniverse = {
      indices: [{ id: 'DJ30', description: 'Dow Jones Industrial Average' }],
      stocks: [{ symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', indices: ['DJ30'] }],
    };

    function mockApiFetch(universeResponse: unknown = fakeUniverse) {
      return vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/contrarian-finder/universe') return Promise.resolve(universeResponse);
        return Promise.resolve(singleBatchResponse());
      });
    }

    test('is collapsed by default and does not fetch the universe until expanded', () => {
      const apiFetchSpy = mockApiFetch();
      renderPage();
      expect(screen.getByRole('button', { name: /Stock Universe \(\? stocks\)/ })).toBeInTheDocument();
      expect(apiFetchSpy).not.toHaveBeenCalledWith('/contrarian-finder/universe');
    });

    test('expanding the toggle fetches and renders the universe table', async () => {
      mockApiFetch();
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /Stock Universe/ }));
      expect(await screen.findByRole('button', { name: /Stock Universe \(1 stocks\)/ })).toBeInTheDocument();
      expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    });

    test('visible and fetchable even for a session with no contrarian_finder:scan permission', async () => {
      mockApiFetch();
      renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }), { roles: ['user'], permissions: [] });
      await userEvent.click(screen.getByRole('button', { name: /Stock Universe/ }));
      expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    });
  });

  describe('Run Scan (+ Mkt Cap)', () => {
    test('clicking the link shows a warning that requires explicit confirmation before running anything', async () => {
      const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
      renderPage();
      expect(apiFetchSpy).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Run Scan (+ Mkt Cap)' }));
      expect(screen.getByText(/isn't something you'd typically need to run/)).toBeInTheDocument();
      expect(client.apiFetch).not.toHaveBeenCalled(); // still hasn't fired - only the warning appeared

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText(/isn't something you'd typically need to run/)).not.toBeInTheDocument();
      expect(client.apiFetch).not.toHaveBeenCalled(); // Cancel never triggers a run
    });

    test('confirming with "Yes, run it" sends updateAllTickerData: true, shows its own progress line while running, then clears it once done (regression: found live 2026-08-02 - the line used to get stuck showing "running" forever)', async () => {
      // A manually-controlled promise, not mockResolvedValue - lets this test
      // deterministically inspect the "still in flight" state (the request
      // is genuinely pending) before resolving it and checking the line
      // disappears, rather than racing a real timer/microtask against a
      // response that resolves too fast to reliably observe as "in progress".
      let resolveFetch!: (value: unknown) => void;
      const pending = new Promise((resolve) => { resolveFetch = resolve; });
      const apiFetchSpy = vi.spyOn(client, 'apiFetch').mockReturnValue(pending as ReturnType<typeof client.apiFetch>);
      renderPage();

      await userEvent.click(screen.getByRole('button', { name: 'Run Scan (+ Mkt Cap)' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, run it' }));

      expect(apiFetchSpy).toHaveBeenCalledWith('/contrarian-finder/scan-batch', {
        method: 'POST',
        body: JSON.stringify({
          batchSize: 125, maxBatches: 3, qualityPreset: 'standard', scanDays: 7, updateAllTickerData: true, batchIndex: 0,
        }),
      });
      expect(await screen.findByText(/Mkt Cap refresh:/)).toBeInTheDocument(); // shows while genuinely in flight

      // universeSize (3) matches updated+skipped (2+1) for this single-batch response.
      resolveFetch({ ...singleBatchResponse(), tickerRefresh: { updated: 2, skipped: 1 } });
      await screen.findByText('Candidates (1)'); // scan has now finished
      expect(screen.queryByText(/Mkt Cap refresh:/)).not.toBeInTheDocument(); // gone, not stuck
    });

    test('a plain "Run scan" click never shows the confirmation or the ticker-refresh progress line', async () => {
      vi.spyOn(client, 'apiFetch').mockResolvedValue(singleBatchResponse());
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));
      await screen.findByText('Candidates (1)');
      expect(screen.queryByText(/isn't something you'd typically need to run/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Mkt Cap refresh:/)).not.toBeInTheDocument();
    });
  });
});
