import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import MasterDataPage from './MasterDataPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MasterDataPage />
    </QueryClientProvider>,
  );
}

describe('MasterDataPage', () => {
  test('shows the Run Delta Update button with no result yet', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Run Delta Update' })).toBeInTheDocument();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
  });

  test('running it shows a summary of updated/skipped/universe size on completion', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      batchIndex: 0, totalBatches: 1, universeSize: 348, updated: 12, skipped: 336,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Run Delta Update' }));

    await waitFor(() => expect(client.apiFetch).toHaveBeenCalledWith('/contrarian-finder/ticker-data-refresh-batch', {
      method: 'POST',
      body: JSON.stringify({ batchIndex: 0 }),
    }));
    expect(await screen.findByText('Updated 12 of 348 symbols (336 already complete).')).toBeInTheDocument();
  });

  test('a missing FMP key shows a 503 message with a button to add one', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(503, 'No fmp API key on file.', null));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Run Delta Update' }));
    expect(await screen.findByText('No fmp API key on file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your fmp api key/i })).toBeInTheDocument();
  });
});

describe('MasterDataPage — Sync Portfolio-Held Tickers (2026-11-06)', () => {
  test('"Sync Now" starts disabled until a preview has actually run', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeDisabled();
  });

  test('"Check for Gaps" fetches the preview and shows the candidate list', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({
      candidates: [{ symbol: 'ACHR', alreadyInUniverse: false }, { symbol: 'IBIT', alreadyInUniverse: false }],
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Check for Gaps' }));

    expect(client.apiFetch).toHaveBeenCalledWith('/contrarian-finder/held-symbol-sync-preview');
    expect(await screen.findByText('2 held symbol(s) need attention: ACHR, IBIT.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeEnabled();
  });

  test('an empty preview leaves "Sync Now" disabled and shows a "no gaps" message', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ candidates: [] });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Check for Gaps' }));

    expect(await screen.findByText(/No gaps found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeDisabled();
  });

  test('"Sync Now" posts the sync and renders all 6 result buckets with their counts and members', async () => {
    vi.spyOn(client, 'apiFetch')
      .mockResolvedValueOnce({ candidates: [{ symbol: 'ACHR', alreadyInUniverse: false }] }) // preview
      .mockResolvedValueOnce({
        added: ['ACHR'], alreadyInUniverse: [], excludedAsEtf: ['IBIT'], excludedAsCrypto: ['BTC'],
        validationFailed: ['SPCX'], capExceeded: [],
      }); // sync
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Check for Gaps' }));
    await screen.findByText(/need attention/);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(client.apiFetch).toHaveBeenCalledWith('/contrarian-finder/held-symbol-sync', { method: 'POST' });
    expect(await screen.findByText('Added (1)')).toBeInTheDocument();
    expect(screen.getByText('Already in Universe (0)')).toBeInTheDocument();
    expect(screen.getByText('Excluded — ETF (1)')).toBeInTheDocument();
    expect(screen.getByText('Excluded — Crypto (1)')).toBeInTheDocument();
    expect(screen.getByText('Could Not Validate (1)')).toBeInTheDocument();
    expect(screen.getByText('Cap Reached (0)')).toBeInTheDocument();
    expect(screen.getByText('ACHR')).toBeInTheDocument();
    expect(screen.getByText('IBIT')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('SPCX')).toBeInTheDocument();
  });

  test('a missing FMP key on sync shows a 503 message with a button to add one', async () => {
    vi.spyOn(client, 'apiFetch')
      .mockResolvedValueOnce({ candidates: [{ symbol: 'ACHR', alreadyInUniverse: false }] }) // preview
      .mockRejectedValueOnce(new ApiError(503, 'No fmp API key on file.', null)); // sync
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Check for Gaps' }));
    await screen.findByText(/need attention/);
    await userEvent.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(await screen.findByText('No fmp API key on file.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /add your fmp api key/i }).length).toBeGreaterThan(0);
  });
});
