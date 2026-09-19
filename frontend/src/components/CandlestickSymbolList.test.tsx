import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import CandlestickSymbolList from './CandlestickSymbolList';

vi.mock('react-chartjs-2', () => ({
  Chart: () => <div data-testid="chart-stub" />,
}));

const SYMBOLS = [
  { symbol: 'AAPL', interval: '5min', updatedAt: '2026-09-18T00:00:00Z', isFresh: true },
  { symbol: 'TSLA', interval: '1day', updatedAt: '2026-09-17T00:00:00Z', isFresh: false },
];

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CandlestickSymbolList />
    </QueryClientProvider>,
  );
}

function mockRoutedFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
    if (path === '/candlestick/cached-symbols') return Promise.resolve(overrides.cachedSymbols ?? { symbols: SYMBOLS });
    if (path.startsWith('/candlestick/')) return Promise.resolve(overrides.snapshot ?? null);
    return Promise.resolve({});
  });
}

describe('CandlestickSymbolList', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('renders one row per cached symbol', async () => {
    mockRoutedFetch();
    renderList();
    expect(await screen.findByTestId('candlestick-list-row-AAPL')).toBeInTheDocument();
    expect(screen.getByTestId('candlestick-list-row-TSLA')).toBeInTheDocument();
  });

  test('fresh symbols render with the success (green) styling, stale ones don\'t', async () => {
    mockRoutedFetch();
    renderList();
    const fresh = await screen.findByTestId('candlestick-list-row-AAPL');
    const stale = screen.getByTestId('candlestick-list-row-TSLA');
    expect(fresh.className).toContain('bg-success/10');
    expect(stale.className).not.toContain('bg-success/10');
  });

  test('shows an empty state when nothing is cached yet', async () => {
    mockRoutedFetch({ cachedSymbols: { symbols: [] } });
    renderList();
    expect(await screen.findByTestId('candlestick-list-empty')).toBeInTheDocument();
  });

  test('clicking a row opens the pop-up for that symbol', async () => {
    mockRoutedFetch();
    renderList();
    await userEvent.click(await screen.findByTestId('candlestick-list-row-AAPL'));
    const popup = await screen.findByTestId('candlestick-popup');
    expect(within(popup).getByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
  });

  test('submitting a new symbol opens the pop-up defaulted to 1day', async () => {
    mockRoutedFetch();
    renderList();
    await userEvent.type(screen.getByTestId('candlestick-new-symbol-input'), 'nvda');
    await userEvent.click(screen.getByTestId('candlestick-new-symbol-go'));

    expect(await screen.findByTestId('candlestick-popup')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByTestId('candlestick-interval-1day')).toHaveClass('bg-accent');
  });

  test('the new-symbol input clears after submit', async () => {
    mockRoutedFetch();
    renderList();
    const input = screen.getByTestId('candlestick-new-symbol-input');
    await userEvent.type(input, 'nvda');
    await userEvent.click(screen.getByTestId('candlestick-new-symbol-go'));
    expect(input).toHaveValue('');
  });
});
