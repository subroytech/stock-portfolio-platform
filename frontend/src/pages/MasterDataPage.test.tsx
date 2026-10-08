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
