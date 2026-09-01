import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import ContrarianRunHistoryDrawer from './ContrarianRunHistoryDrawer';
import type { RunHistoryListItem } from '../api/contrarianFinder';

const RUNS: RunHistoryListItem[] = [
  { id: '2', completedAt: '2026-08-31T10:00:00Z', universeSize: 458, scanned: 458, params: { threshold: 25, batchSize: 125, maxBatches: 5, qualityPreset: 'standard', scanDays: 7 } },
  { id: '1', completedAt: '2026-08-29T10:00:00Z', universeSize: 458, scanned: 450, params: { threshold: 30, batchSize: 125, maxBatches: 5, qualityPreset: 'relaxed', scanDays: 7 } },
];

function renderDrawer(props: Partial<React.ComponentProps<typeof ContrarianRunHistoryDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSelectRun = vi.fn();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ContrarianRunHistoryDrawer isOpen onClose={onClose} onSelectRun={onSelectRun} {...props} />
    </QueryClientProvider>,
  );
  return { ...result, onClose, onSelectRun };
}

describe('ContrarianRunHistoryDrawer', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('renders nothing when isOpen is false', () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: RUNS });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContrarianRunHistoryDrawer isOpen={false} onClose={vi.fn()} onSelectRun={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('run-history-drawer')).not.toBeInTheDocument();
  });

  test('shows a loading state, then lists every run newest-first with its metadata', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: RUNS });
    renderDrawer();

    expect(await screen.findByTestId('run-history-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('run-history-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-history-row-2')).toHaveTextContent('25% Threshold - 7 Day Window');
    expect(screen.getByTestId('run-history-row-1')).toHaveTextContent('30% Threshold - 7 Day Window');
  });

  test('shows an empty state when no runs have ever been saved', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: [] });
    renderDrawer();
    expect(await screen.findByTestId('run-history-empty')).toBeInTheDocument();
  });

  test('shows an error state when the list call fails', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new client.ApiError(500, 'boom', null));
    renderDrawer();
    expect(await screen.findByText('Could not load run history.')).toBeInTheDocument();
  });

  test('clicking a row calls onSelectRun with that run', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: RUNS });
    const { onSelectRun } = renderDrawer();
    await userEvent.click(await screen.findByTestId('run-history-row-1'));
    expect(onSelectRun).toHaveBeenCalledWith(RUNS[1]);
  });

  test('clicking the backdrop or Close calls onClose', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: RUNS });
    const { onClose } = renderDrawer();
    await screen.findByTestId('run-history-row-2');
    await userEvent.click(screen.getByTestId('run-history-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the drawer panel itself does not close it', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ runs: RUNS });
    const { onClose } = renderDrawer();
    await userEvent.click(await screen.findByTestId('run-history-drawer'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
