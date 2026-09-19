import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import CandlestickPopup from './CandlestickPopup';

// The actual data-testid for each panel lives on CandlestickPopup's own wrapper <div> around
// each <Chart> (candlestick-price-chart/-volume-chart/-rsi-chart/-macd-chart) - this stub just
// needs to render something harmless, not carry its own testid. Captures every render's
// full props (data/options) so tests can inspect the actual dataset x-values and invoke the
// real tick/tooltip callbacks - CandlestickPopup.tsx doesn't export those helpers directly, so
// this is how their behavior gets exercised.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const capturedCharts: any[] = [];
vi.mock('react-chartjs-2', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Chart: (props: any) => {
    capturedCharts.push(props);
    return <div data-chart-type={props.type} />;
  },
}));

const SNAPSHOT = {
  bars: [
    { date: '2026-09-18', open: 10, high: 12, low: 9, close: 11, volume: 1000 },
    { date: '2026-09-17', open: 9, high: 10, low: 8, close: 10, volume: 900 },
  ],
  indicators: {
    sma20: [11, 10], sma50: [11, 10], ema20: [11, 10], rsi14: [60, 55],
    macd: [{ macd: 0.5, signal: 0.3, hist: 0.2 }, { macd: 0.4, signal: 0.2, hist: 0.2 }],
    bb20: [{ upper: 12, mid: 11, lower: 10, bw: 0.1 }, { upper: 11, mid: 10, lower: 9, bw: 0.1 }],
    volume: [1000, 900],
    vwap: [11, 10],
    pivotPoints: { pp: 10, r1: 11, r2: 12, r3: 13, s1: 9, s2: 8, s3: 7 },
    fibonacci: { swingHigh: 12, swingLow: 8, direction: 'down', levels: [{ pct: 0.5, price: 10 }] },
  },
  updatedAt: '2026-09-18T15:00:00Z',
  isFresh: true,
};

function renderPopup(props: Partial<React.ComponentProps<typeof CandlestickPopup>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CandlestickPopup symbol="AAPL" initialInterval="1day" onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

function mockRoutedFetch(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/candlestick/AAPL/1day' && !init) {
      if (overrides.notCached) return Promise.reject(new ApiError(404, 'No cached data for this symbol/interval yet.', null));
      return Promise.resolve(overrides.snapshot ?? SNAPSHOT);
    }
    if (path === '/candlestick/AAPL/1day/refresh') {
      if (overrides.rateLimited) return Promise.reject(new ApiError(429, 'You\'ve reached the limit of 10 new candlestick requests per 10 minutes. Please try again shortly.', null));
      return Promise.resolve(overrides.refreshResult ?? SNAPSHOT);
    }
    // Any other interval (e.g. after switching timeframes) has never been cached in this test -
    // a real 404, matching what the backend actually returns for an uncached symbol/interval,
    // not a silently-successful empty object.
    if (path.startsWith('/candlestick/')) return Promise.reject(new ApiError(404, 'No cached data for this symbol/interval yet.', null));
    return Promise.resolve({});
  });
}

describe('CandlestickPopup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    capturedCharts.length = 0;
  });

  test('shows the confirm-to-fetch prompt when nothing is cached yet, never auto-fetching', async () => {
    const apiFetch = mockRoutedFetch({ notCached: true });
    renderPopup();
    expect(await screen.findByTestId('candlestick-confirm-fetch')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith('/candlestick/AAPL/1day/refresh', expect.anything());
  });

  test('clicking the confirm button triggers the real fetch', async () => {
    const apiFetch = mockRoutedFetch({ notCached: true });
    renderPopup();
    await userEvent.click(await screen.findByTestId('candlestick-confirm-fetch-button'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/candlestick/AAPL/1day/refresh', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByTestId('candlestick-price-chart')).toBeInTheDocument();
  });

  test('a rate-limit error from the confirm action shows the backend\'s own message', async () => {
    mockRoutedFetch({ notCached: true, rateLimited: true });
    renderPopup();
    await userEvent.click(await screen.findByTestId('candlestick-confirm-fetch-button'));
    expect(await screen.findByText(/reached the limit of 10 new candlestick requests/)).toBeInTheDocument();
  });

  test('shows the freshness badge and time of pull for cached data', async () => {
    mockRoutedFetch();
    renderPopup();
    expect(await screen.findByTestId('candlestick-freshness-badge')).toHaveTextContent('Fresh');
    expect(screen.getByTestId('candlestick-time-of-pull')).toBeInTheDocument();
  });

  test('stale data shows a Refresh action instead of a Fresh badge', async () => {
    mockRoutedFetch({ snapshot: { ...SNAPSHOT, isFresh: false } });
    renderPopup();
    expect(await screen.findByTestId('candlestick-freshness-badge')).toHaveTextContent('Stale');
    expect(screen.getByTestId('candlestick-refresh-button')).toBeInTheDocument();
  });

  test('fresh data does not show a Refresh action', async () => {
    mockRoutedFetch();
    renderPopup();
    await screen.findByTestId('candlestick-freshness-badge');
    expect(screen.queryByTestId('candlestick-refresh-button')).not.toBeInTheDocument();
  });

  test('renders the price and volume charts once data loads, indicator panels start closed', async () => {
    mockRoutedFetch();
    renderPopup();
    expect(await screen.findByTestId('candlestick-price-chart')).toBeInTheDocument();
    expect(screen.getByTestId('candlestick-volume-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-rsi-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candlestick-macd-chart')).not.toBeInTheDocument();
  });

  test('toggling RSI/MACD shows their own stacked panel', async () => {
    mockRoutedFetch();
    renderPopup();
    await screen.findByTestId('candlestick-price-chart');

    await userEvent.click(screen.getByTestId('candlestick-toggle-rsi'));
    expect(screen.getByTestId('candlestick-rsi-chart')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('candlestick-toggle-macd'));
    expect(screen.getByTestId('candlestick-macd-chart')).toBeInTheDocument();
  });

  test('switching the interval re-queries the snapshot for the new interval', async () => {
    const apiFetch = mockRoutedFetch();
    renderPopup();
    await screen.findByTestId('candlestick-price-chart');

    await userEvent.click(screen.getByTestId('candlestick-interval-5min'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/candlestick/AAPL/5min'));
  });

  test('Close calls onClose', async () => {
    mockRoutedFetch();
    const { onClose } = renderPopup();
    await screen.findByTestId('candlestick-price-chart');
    await userEvent.click(screen.getByTestId('candlestick-popup-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Phase 1.1 - index-based x-axis (gap-free, no real elapsed-time positioning)', () => {
    test('candlestick bars are positioned by sequence index, not by real timestamp', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      const priceChart = capturedCharts.find((c) => c.type === 'candlestick');
      // SNAPSHOT.bars is newest-first (2026-09-18, 2026-09-17) - chronological order reverses
      // that, so index 0 is the OLDER bar (09-17) and index 1 is the NEWER one (09-18).
      expect(priceChart.data.datasets[0].data).toEqual([
        { x: 0, o: 9, h: 10, l: 8, c: 10 },
        { x: 1, o: 10, h: 12, l: 9, c: 11 },
      ]);
    });

    test('an indicator series is paired with the correctly-corresponding chronological bar, not mismatched (the real bug found while building this)', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');
      await userEvent.click(screen.getByTestId('candlestick-toggle-ma'));

      const priceChart = capturedCharts.filter((c) => c.type === 'candlestick').pop();
      const sma20Dataset = priceChart.data.datasets.find((d: { label: string }) => d.label === 'SMA 20');
      // indicators.sma20 = [11, 10] is newest-first (11 = the 09-18 bar's own SMA, 10 = the
      // 09-17 bar's). Reversed to chronological: index 0 (the 09-17 bar) must pair with 10, and
      // index 1 (the 09-18 bar) must pair with 11 - not swapped.
      expect(sma20Dataset.data).toEqual([{ x: 0, y: 10 }, { x: 1, y: 11 }]);
    });

    test('the price chart\'s x-axis tick callback resolves each index back to a distinct real date, not a constant or a raw index', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      const priceChart = capturedCharts.find((c) => c.type === 'candlestick');
      const tickCallback = priceChart.options.scales.x.ticks.callback;
      const label0 = tickCallback(0);
      const label1 = tickCallback(1);
      expect(label0).not.toBe('');
      expect(label1).not.toBe('');
      expect(label0).not.toBe(label1);
      expect(tickCallback(99)).toBe(''); // out of range - no bar at that index
    });

    test('the volume chart\'s y-axis formats large numbers as K/M instead of raw digits', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-volume-chart');

      const volumeChart = capturedCharts.find((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume');
      const tickCallback = volumeChart.options.scales.y.ticks.callback;
      expect(tickCallback(4_000_000)).toBe('4M');
      expect(tickCallback(4_500_000)).toBe('4.5M');
      expect(tickCallback(2_000)).toBe('2K');
      expect(tickCallback(500)).toBe('500');
    });

    test('the volume/RSI/MACD panels hide their own axis labels (the price chart above is the one shared axis) but still resolve real dates for tooltips', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');
      await userEvent.click(screen.getByTestId('candlestick-toggle-rsi'));

      const volumeChart = capturedCharts.find((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume');
      expect(volumeChart.options.scales.x.ticks.display).toBe(false);

      const rsiChart = capturedCharts.find((c) => c.type === 'line');
      expect(rsiChart.options.scales.x.ticks.display).toBe(false);
      const tooltipTitle = rsiChart.options.plugins.tooltip.callbacks.title([{ dataIndex: 1 }]);
      expect(tooltipTitle).not.toBe('');
    });
  });
});
