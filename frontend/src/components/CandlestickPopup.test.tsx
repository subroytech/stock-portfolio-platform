import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import CandlestickPopup from './CandlestickPopup';

// Spies on the real useNavigate so the "Ask about patterns" shortcut's navigation target can be
// asserted directly - MemoryRouter alone (no <Routes>) has nowhere to actually render the
// destination page, so this is more precise than trying to observe a location change.
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

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
    volumeSma20: [950, 900],
    vwap: [11, 10],
    obv: [1000, 0],
    pivotPoints: { pp: 10, r1: 11, r2: 12, r3: 13, s1: 9, s2: 8, s3: 7 },
    fibonacci: { swingHigh: 12, swingLow: 8, direction: 'down', levels: [{ pct: 0.5, price: 10 }] },
  },
  updatedAt: '2026-09-18T15:00:00Z',
  isFresh: true,
  companyName: 'Apple Inc.',
};

function renderPopup(props: Partial<React.ComponentProps<typeof CandlestickPopup>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CandlestickPopup symbol="AAPL" initialInterval="1day" onClose={onClose} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

// `interval` defaults to '1day' (Long-Term) to match renderPopup()'s own default - pass '30min'
// (Medium-Term) for tests exercising RSI/BB, since the 2026-09-20 indicator-relevance filtering
// hides those two toggles at 1day (see lib/candlestickIndicators.ts).
function mockRoutedFetch(overrides: Record<string, unknown> = {}, interval = '1day') {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
    if (path === `/candlestick/AAPL/${interval}` && !init) {
      if (overrides.notCached) return Promise.reject(new ApiError(404, 'No cached data for this symbol/interval yet.', null));
      return Promise.resolve(overrides.snapshot ?? SNAPSHOT);
    }
    if (path === `/candlestick/AAPL/${interval}/refresh`) {
      if (overrides.rateLimited) return Promise.reject(new ApiError(429, 'You\'ve reached the limit of 10 new candlestick requests per 10 minutes. Please try again shortly.', null));
      return Promise.resolve(overrides.refreshResult ?? SNAPSHOT);
    }
    // Backs the Symbol Switcher's own useCachedSymbolsList() call - defaults to empty so existing
    // tests that don't care about the switcher's list body see nothing rendered, same as before
    // this hook existed. Checked before the generic '/candlestick/' 404 catch-all below, which
    // would otherwise swallow this specific path too.
    if (path === '/candlestick/cached-symbols') {
      return Promise.resolve(overrides.cachedSymbols ?? { symbols: [] });
    }
    // Symbol Switcher tests only - an optional per-symbol snapshot map for switching to a symbol
    // other than AAPL (the fixed symbol every other test in this file assumes). Checked before the
    // generic '/candlestick/' 404 catch-all below.
    const otherSymbolMatch = path.match(new RegExp(`^/candlestick/([A-Z]+)/${interval}$`));
    if (otherSymbolMatch && overrides.otherSymbolSnapshots) {
      const snap = (overrides.otherSymbolSnapshots as Record<string, unknown>)[otherSymbolMatch[1]];
      if (snap) return Promise.resolve(snap);
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
    mockNavigate.mockClear();
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

  test('shows the company name, in bold, in front of the freshness message', async () => {
    mockRoutedFetch();
    renderPopup();
    const companyName = await screen.findByTestId('candlestick-company-name');
    expect(companyName).toHaveTextContent('Apple Inc.');
    expect(companyName).toHaveClass('font-bold');
  });

  test('omits the company name entirely when none has been peeked yet, rather than a blank label', async () => {
    mockRoutedFetch({ snapshot: { ...SNAPSHOT, companyName: null } });
    renderPopup();
    await screen.findByTestId('candlestick-freshness-badge');
    expect(screen.queryByTestId('candlestick-company-name')).not.toBeInTheDocument();
  });

  test('stale data shows a Refresh action instead of a Fresh badge', async () => {
    // '30min', not the default '1day' - 1day auto-refreshes itself away from Stale (see the
    // dedicated describe block below), so this needs an interval unaffected by that to test the
    // plain stale-badge-rendering behavior in isolation.
    mockRoutedFetch({ snapshot: { ...SNAPSHOT, isFresh: false } }, '30min');
    renderPopup({ initialInterval: '30min' });
    expect(await screen.findByTestId('candlestick-freshness-badge')).toHaveTextContent('Stale');
    expect(screen.getByTestId('candlestick-refresh-button')).toBeInTheDocument();
  });

  test('fresh data does not show a Refresh action', async () => {
    mockRoutedFetch();
    renderPopup();
    await screen.findByTestId('candlestick-freshness-badge');
    expect(screen.queryByTestId('candlestick-refresh-button')).not.toBeInTheDocument();
  });

  // Auto-refresh on open (2026-09-25, explicit direction) - opening a symbol from the left-hand
  // panel is itself a signal the user wants current data, scoped to the 1-Day view specifically
  // (the default view; other intervals have their own much shorter 10-minute freshness window).
  describe('1-Day auto-refresh on open when stale', () => {
    test('a stale 1-Day snapshot triggers a refresh automatically, with no click needed', async () => {
      const apiFetch = mockRoutedFetch({ snapshot: { ...SNAPSHOT, isFresh: false } });
      renderPopup();

      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/candlestick/AAPL/1day/refresh', expect.objectContaining({ method: 'POST' })));
      expect(await screen.findByTestId('candlestick-freshness-badge')).toHaveTextContent('Fresh');
    });

    test('a fresh 1-Day snapshot never triggers an automatic refresh', async () => {
      const apiFetch = mockRoutedFetch(); // default SNAPSHOT is already isFresh: true
      renderPopup();

      await screen.findByTestId('candlestick-freshness-badge');
      expect(apiFetch).not.toHaveBeenCalledWith('/candlestick/AAPL/1day/refresh', expect.anything());
    });

    test('a stale non-1-Day interval never auto-refreshes - only 1-Day does', async () => {
      const apiFetch = mockRoutedFetch({ snapshot: { ...SNAPSHOT, isFresh: false } }, '30min');
      renderPopup({ initialInterval: '30min' });

      await screen.findByTestId('candlestick-freshness-badge');
      expect(apiFetch).not.toHaveBeenCalledWith('/candlestick/AAPL/30min/refresh', expect.anything());
    });

    test('an exhausted rate limit on the automatic refresh surfaces the same error a manual click would', async () => {
      mockRoutedFetch({ snapshot: { ...SNAPSHOT, isFresh: false }, rateLimited: true });
      renderPopup();

      expect(await screen.findByText(/reached the limit of 10 new candlestick requests/)).toBeInTheDocument();
    });
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
    // '30min' (Medium-Term) - RSI is filtered out at the default '1day' (Long-Term) interval by
    // the 2026-09-20 indicator-relevance work below.
    mockRoutedFetch({}, '30min');
    renderPopup({ initialInterval: '30min' });
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

  test('the Back link (replacing the old Close button, 2026-09-25) calls onClose', async () => {
    mockRoutedFetch();
    const { onClose } = renderPopup();
    await screen.findByTestId('candlestick-price-chart');
    await userEvent.click(screen.getByTestId('candlestick-popup-back'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Candlestick Pattern Q&A (Phase 1) - a contextual shortcut, hidden entirely without the
  // permission (same pattern as every other gated entry point in this app).
  describe('"Ask about patterns" shortcut', () => {
    test('is hidden when the session lacks candlestick_question_answer:ask', async () => {
      mockRoutedFetch(); // default /auth/me response has no permissions field at all
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');
      expect(screen.queryByTestId('candlestick-ask-about-patterns')).not.toBeInTheDocument();
    });

    test('closes the popup and navigates to the Q&A tab when clicked', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['candlestick_question_answer:ask'] });
        if (path === '/candlestick/AAPL/1day') return Promise.resolve(SNAPSHOT);
        return Promise.resolve({});
      });
      const { onClose } = renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      await userEvent.click(await screen.findByTestId('candlestick-ask-about-patterns'));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/candlestick-question-answer');
    });

    test('shares one wrapping group with Quick Reference, so the two can never wrap onto separate lines (the real bug fixed 2026-09-25)', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['candlestick_question_answer:ask'] });
        if (path === '/candlestick/AAPL/1day') return Promise.resolve(SNAPSHOT);
        return Promise.resolve({});
      });
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      const askLink = await screen.findByTestId('candlestick-ask-about-patterns');
      const quickReference = screen.getByTestId('candlestick-view-quick-reference');
      expect(askLink.parentElement).toBe(quickReference.parentElement);
    });
  });

  // Quick Reference (2026-09-19, renamed same day from "Cheat Sheet" for clarity) - a static tab
  // living inside this same popup, not a new top-level app tab, since it's meant to help
  // interpret the diagram already open, not stand alone.
  describe('Candlestick / Quick Reference view switch', () => {
    test('defaults to the Candlestick view, with the chart panels and Quick Reference content mutually exclusive', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');
      expect(screen.queryByTestId('candlestick-quick-reference')).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId('candlestick-view-quick-reference'));
      expect(screen.getByTestId('candlestick-quick-reference')).toBeInTheDocument();
      expect(screen.queryByTestId('candlestick-price-chart')).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId('candlestick-view-candlestick'));
      expect(screen.getByTestId('candlestick-price-chart')).toBeInTheDocument();
      expect(screen.queryByTestId('candlestick-quick-reference')).not.toBeInTheDocument();
    });

    test('Quick Reference renders even with no cached data yet - it has no data dependency of its own', async () => {
      mockRoutedFetch({ notCached: true });
      renderPopup();
      await screen.findByTestId('candlestick-confirm-fetch');

      await userEvent.click(screen.getByTestId('candlestick-view-quick-reference'));
      expect(screen.getByTestId('candlestick-quick-reference')).toBeInTheDocument();
      expect(screen.queryByTestId('candlestick-confirm-fetch')).not.toBeInTheDocument();
    });

    // Real usability bug found live 2026-09-20: the timeframe buttons stayed fully clickable
    // while Quick Reference was active, silently changing `interval` state with no visible
    // effect (Quick Reference has no chart to apply it to). They're disabled now, not hidden -
    // this keeps the single-line header layout stable rather than reflowing width.
    test('the timeframe buttons are disabled while Quick Reference is active, and re-enable on switching back', async () => {
      const apiFetch = mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');
      expect(screen.getByTestId('candlestick-interval-5min')).toBeEnabled();

      await userEvent.click(screen.getByTestId('candlestick-view-quick-reference'));
      expect(screen.getByTestId('candlestick-interval-5min')).toBeDisabled();

      // A disabled button ignores the click - no re-query fires for it.
      await userEvent.click(screen.getByTestId('candlestick-interval-5min'));
      expect(apiFetch).not.toHaveBeenCalledWith('/candlestick/AAPL/5min');

      await userEvent.click(screen.getByTestId('candlestick-view-candlestick'));
      expect(screen.getByTestId('candlestick-interval-5min')).toBeEnabled();
    });
  });

  // Indicator relevance filtering (2026-09-20, per explicit direction: "based on Quick
  // Reference's own relevance, only make the relevant indicators available for that timeframe").
  // The exact sets asserted below mirror CandlestickQuickReference.tsx's own Core Indicators
  // lists (and lib/candlestickIndicators.ts's INTERVAL_HORIZON mapping) - HORIZON_INDICATORS is
  // derived directly from that same content, so these two surfaces can't drift apart.
  describe('Indicator relevance filtering', () => {
    const ALL_INDICATOR_TESTIDS = [
      'candlestick-toggle-ma', 'candlestick-toggle-bb', 'candlestick-toggle-vwap', 'candlestick-toggle-pivotPoints',
      'candlestick-toggle-fibonacci', 'candlestick-toggle-rsi', 'candlestick-toggle-macd', 'candlestick-toggle-volumeMa',
      'candlestick-toggle-obv',
    ];

    test('Day Trading (5min) shows only VWAP/Volume MA/Pivot Points/RSI/Bollinger Bands/MACD', async () => {
      mockRoutedFetch({}, '5min');
      renderPopup({ initialInterval: '5min' });
      await screen.findByTestId('candlestick-price-chart');

      const shown = ALL_INDICATOR_TESTIDS.filter((id) => screen.queryByTestId(id));
      expect(shown.sort()).toEqual([
        'candlestick-toggle-bb', 'candlestick-toggle-macd', 'candlestick-toggle-pivotPoints',
        'candlestick-toggle-rsi', 'candlestick-toggle-volumeMa', 'candlestick-toggle-vwap',
      ].sort());
      expect(screen.getByTestId('candlestick-horizon-caption')).toHaveTextContent('Day Trading');
    });

    test('Long-Term (1day, the default) shows only Moving Averages/MACD/OBV/Volume MA/Fibonacci', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      const shown = ALL_INDICATOR_TESTIDS.filter((id) => screen.queryByTestId(id));
      expect(shown.sort()).toEqual([
        'candlestick-toggle-fibonacci', 'candlestick-toggle-ma', 'candlestick-toggle-macd',
        'candlestick-toggle-obv', 'candlestick-toggle-volumeMa',
      ].sort());
      // VWAP/Pivot Points/RSI/Bollinger Bands are all explicitly named in that horizon's own
      // "Skip" line in Quick Reference - never shown as toggleable here either.
      expect(screen.queryByTestId('candlestick-toggle-vwap')).not.toBeInTheDocument();
      expect(screen.queryByTestId('candlestick-toggle-rsi')).not.toBeInTheDocument();
      expect(screen.getByTestId('candlestick-horizon-caption')).toHaveTextContent('Long-Term (Position)');
    });

    test('switching from a Medium-Term timeframe to Long-Term prunes an indicator no longer relevant, closing its stacked panel', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/candlestick/AAPL/30min' || path === '/candlestick/AAPL/1day') return Promise.resolve(SNAPSHOT);
        return Promise.reject(new ApiError(404, 'No cached data for this symbol/interval yet.', null));
      });
      renderPopup({ initialInterval: '30min' });
      await screen.findByTestId('candlestick-price-chart');

      await userEvent.click(screen.getByTestId('candlestick-toggle-rsi'));
      expect(screen.getByTestId('candlestick-rsi-chart')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('candlestick-interval-1day'));
      // RSI isn't relevant to Long-Term - both its toggle button and its now-orphaned stacked
      // panel must disappear together, not just the button (the real bug this pruning prevents:
      // a toggled-on indicator surviving a timeframe switch with no way left to turn it off).
      await waitFor(() => expect(screen.queryByTestId('candlestick-toggle-rsi')).not.toBeInTheDocument());
      expect(screen.queryByTestId('candlestick-rsi-chart')).not.toBeInTheDocument();
      expect(screen.getByTestId('candlestick-horizon-caption')).toHaveTextContent('Long-Term (Position)');
    });
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

    // Real bug found live 2026-09-19: with no explicit x-axis bounds, Chart.js's default
    // `bounds: 'ticks'` rounded the axis out to the nearest "nice" tick step on each side
    // independently, producing an asymmetric gap (measured ~3x more padding on the right than
    // the left on a real chart) with no intentional reason for either. Every stacked panel's
    // x-scale must be pinned to exactly [0, chronological.length - 1] - both to eliminate that
    // padding and to guarantee the four panels can't drift out of alignment with each other.
    test('every stacked panel\'s x-axis is pinned to the exact data range, not left to an auto-padded one', async () => {
      // '30min' (Medium-Term) - RSI is filtered out at the default '1day' (Long-Term) interval.
      mockRoutedFetch({}, '30min');
      renderPopup({ initialInterval: '30min' });
      await screen.findByTestId('candlestick-price-chart');
      await userEvent.click(screen.getByTestId('candlestick-toggle-rsi'));
      await userEvent.click(screen.getByTestId('candlestick-toggle-macd'));

      const priceChart = capturedCharts.find((c) => c.type === 'candlestick');
      const volumeChart = capturedCharts.find((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume');
      const rsiChart = capturedCharts.find((c) => c.type === 'line');
      const macdChart = capturedCharts.find((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Histogram');

      // SNAPSHOT.bars has 2 entries - the exact data range is index 0 to 1, not auto-rounded.
      for (const chart of [priceChart, volumeChart, rsiChart, macdChart]) {
        expect(chart.options.scales.x.min).toBe(0);
        expect(chart.options.scales.x.max).toBe(1);
      }
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

    test('a daily bar\'s tick/tooltip date is computed in UTC, not the viewer\'s local timezone (the real bug found live 2026-09-25)', async () => {
      // A bare "2026-09-18" (no time component) parses as UTC midnight - without pinning
      // timeZone: 'UTC' on the formatter, a viewer west of UTC would see the previous calendar
      // day instead (a real Monday bar displayed as "Sun" in production). Spying on the actual
      // toLocaleDateString call args, rather than asserting the rendered text, keeps this
      // deterministic regardless of the test runner's own local timezone.
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-price-chart');

      const toLocaleDateStringSpy = vi.spyOn(Date.prototype, 'toLocaleDateString');
      const priceChart = capturedCharts.find((c) => c.type === 'candlestick');
      priceChart.options.scales.x.ticks.callback(0);

      expect(toLocaleDateStringSpy).toHaveBeenCalledWith('en-US', expect.objectContaining({ timeZone: 'UTC' }));
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

    test('toggling Volume MA adds a smoothed line to the volume chart on the same axis as the bars', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-volume-chart');

      await userEvent.click(screen.getByTestId('candlestick-toggle-volumeMa'));

      const volumeChart = capturedCharts.filter((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume').pop();
      const maDataset = volumeChart.data.datasets.find((d: { label: string }) => d.label === 'Volume MA (20)');
      // volumeSma20 = [950, 900] is newest-first - reversed to chronological: index 0 (older) ->
      // 900, index 1 (newer) -> 950, same pairing convention as every other overlay series.
      expect(maDataset.data).toEqual([{ x: 0, y: 900 }, { x: 1, y: 950 }]);
      expect(maDataset.yAxisID).toBeUndefined(); // shares the Volume bars' own (right-side) axis
    });

    test('the OBV axis is hidden until toggled, then renders on its own left-side axis', async () => {
      mockRoutedFetch();
      renderPopup();
      await screen.findByTestId('candlestick-volume-chart');

      let volumeChart = capturedCharts.filter((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume').pop();
      expect(volumeChart.options.scales.y1.display).toBe(false);

      await userEvent.click(screen.getByTestId('candlestick-toggle-obv'));

      volumeChart = capturedCharts.filter((c) => c.type === 'bar' && c.data.datasets[0]?.label === 'Volume').pop();
      expect(volumeChart.options.scales.y1.display).toBe(true);
      const obvDataset = volumeChart.data.datasets.find((d: { label: string }) => d.label === 'OBV');
      expect(obvDataset.yAxisID).toBe('y1');
      // obv = [1000, 0] is newest-first - reversed to chronological: index 0 -> 0, index 1 -> 1000.
      expect(obvDataset.data).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1000 }]);
    });

    test('the volume/RSI/MACD panels hide their own axis labels (the price chart above is the one shared axis) but still resolve real dates for tooltips', async () => {
      // '30min' (Medium-Term) - RSI is filtered out at the default '1day' (Long-Term) interval.
      mockRoutedFetch({}, '30min');
      renderPopup({ initialInterval: '30min' });
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

  describe('Pattern Detection panel (2026-09-26 POC, initially 1-Day only, expanded to every interval 2026-09-27)', () => {
    // Bars are newest-first (API convention, matching SNAPSHOT above) - toChronological()
    // reverses them, so oldest-first this becomes
    // [doji, hammer, no-pattern, shootingStar, spinningTop, marubozu, beltHold, longLeggedDoji,
    //  dragonflyDoji, gravestoneDoji].
    const PATTERN_SNAPSHOT = {
      ...SNAPSHOT,
      bars: [
        { date: '2026-09-26', open: 10, high: 19.75, low: 10, close: 10.05, volume: 1900 }, // gravestoneDoji
        { date: '2026-09-25', open: 9.7, high: 9.75, low: 0, close: 9.75, volume: 1800 }, // dragonflyDoji
        { date: '2026-09-24', open: 10, high: 13.9, low: 3.9, close: 10.5, volume: 1700 }, // longLeggedDoji
        { date: '2026-09-23', open: 10, high: 16, low: 10, close: 13.6, volume: 1600 }, // beltHold (bullish)
        { date: '2026-09-22', open: 10, high: 19.5, low: 9.5, close: 19, volume: 1500 }, // marubozu (bullish)
        { date: '2026-09-21', open: 10, high: 16.5, low: 6.5, close: 13, volume: 1400 }, // spinningTop
        { date: '2026-09-20', open: 10, high: 14, low: 7, close: 8, volume: 1200 }, // shootingStar
        { date: '2026-09-19', open: 10, high: 16, low: 4, close: 14, volume: 1100 }, // no pattern
        { date: '2026-09-18', open: 10, high: 13, low: 6, close: 12, volume: 1000 }, // hammer
        { date: '2026-09-17', open: 10, high: 12, low: 2, close: 10, volume: 900 }, // doji (generic, not a sub-type)
      ],
    };

    test('at the default 1-Day interval, badges render for each detected pattern, one per pattern', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();

      const panel = await screen.findByTestId('candlestick-pattern-panel');
      const badges = screen.getAllByTestId('pattern-badge');
      expect(badges).toHaveLength(9);
      expect(badges.map((b) => b.getAttribute('data-pattern')).sort()).toEqual(
        ['beltHold', 'doji', 'dragonflyDoji', 'gravestoneDoji', 'hammer', 'longLeggedDoji', 'marubozu', 'shootingStar', 'spinningTop'],
      );
      expect(panel).toContainElement(badges[0]);
    });

    test('detection also works on a non-1-Day interval (2026-09-27: no longer 1-Day-only)', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT }, '5min');
      renderPopup({ initialInterval: '5min' });

      const badges = await screen.findAllByTestId('pattern-badge');
      expect(badges).toHaveLength(9);
    });

    test('a Belt Hold badge shows B+/green or B-/red based on that specific bar\'s own bullish/bearish direction, not a fixed label/color', async () => {
      const BELT_HOLD_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 13.6, high: 16, low: 10, close: 10, volume: 1000 }, // bearish belt hold
          { date: '2026-09-17', open: 10, high: 16, low: 10, close: 13.6, volume: 900 }, // bullish belt hold
        ],
      };
      mockRoutedFetch({ snapshot: BELT_HOLD_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      expect(badges).toHaveLength(2);
      // Chronological order (oldest first): index 0 = bullish (the 09-17 bar), index 1 = bearish.
      expect(badges[0]).toHaveTextContent('B+');
      expect(badges[0].className).toContain('bg-green-600');
      expect(badges[1]).toHaveTextContent('B-');
      expect(badges[1].className).toContain('bg-red-600');
    });

    test('a Marubozu badge shows M+/green or M-/red based on that specific bar\'s own bullish/bearish direction, not a fixed label/color', async () => {
      const MARUBOZU_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 20, high: 20.2, low: 9.8, close: 10, volume: 1000 }, // bearish marubozu
          { date: '2026-09-17', open: 10, high: 20.2, low: 9.8, close: 20, volume: 900 }, // bullish marubozu
        ],
      };
      mockRoutedFetch({ snapshot: MARUBOZU_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      expect(badges).toHaveLength(2);
      // Chronological order (oldest first): index 0 = bullish (the 09-17 bar), index 1 = bearish.
      expect(badges[0]).toHaveTextContent('M+');
      expect(badges[0].className).toContain('bg-green-600');
      expect(badges[1]).toHaveTextContent('M-');
      expect(badges[1].className).toContain('bg-red-600');
    });

    test('a badge renders at a safe left:0px fallback rather than throwing when the price chart ref is unset', async () => {
      // react-chartjs-2's Chart is mocked as a stub <div> in this file, so priceChartRef.current
      // never actually gets assigned a real Chart.js instance - the exact condition this must
      // degrade gracefully under, both here and in the instant before a real chart mounts.
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      badges.forEach((badge) => expect(badge).toHaveStyle({ left: '0px' }));
    });

    test('the panel and its picker stay present after switching away from 1-Day (2026-09-27: expanded to every interval)', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
        if (path === '/candlestick/AAPL/1day' || path === '/candlestick/AAPL/30min') return Promise.resolve(PATTERN_SNAPSHOT);
        return Promise.reject(new ApiError(404, 'No cached data for this symbol/interval yet.', null));
      });
      renderPopup();
      await screen.findByTestId('candlestick-pattern-panel');

      await userEvent.click(screen.getByTestId('candlestick-interval-30min'));

      await screen.findByTestId('candlestick-price-chart');
      expect(screen.getByTestId('candlestick-pattern-panel')).toBeInTheDocument();
      expect(screen.getByTestId('candlestick-pattern-picker-row')).toBeInTheDocument();
    });

    test('the picker defaults to all 9 patterns checked, and unchecking one hides just its badges without closing the menu', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();
      await screen.findByTestId('candlestick-pattern-panel');

      await userEvent.click(screen.getByTestId('candlestick-pattern-picker-button'));
      expect(screen.getByTestId('candlestick-pattern-picker-button')).toHaveTextContent('9 of 9 shown');
      const menu = screen.getByTestId('candlestick-pattern-picker-menu');
      for (const key of ['doji', 'hammer', 'shootingStar', 'marubozu', 'spinningTop', 'dragonflyDoji', 'gravestoneDoji', 'longLeggedDoji', 'beltHold']) {
        expect(screen.getByTestId(`candlestick-pattern-picker-option-${key}`).querySelector('input')).toBeChecked();
      }
      const hammerOption = screen.getByTestId('candlestick-pattern-picker-option-hammer');

      await userEvent.click(hammerOption.querySelector('input')!);

      // Unchecking a pattern is not a "close the menu" action, unlike a single-select filter.
      expect(menu).toBeInTheDocument();
      const remaining = screen.getAllByTestId('pattern-badge');
      expect(remaining).toHaveLength(8);
      expect(remaining.map((b) => b.getAttribute('data-pattern'))).not.toContain('hammer');
    });

    test('clicking the backdrop closes the picker menu', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();
      await screen.findByTestId('candlestick-pattern-panel');

      await userEvent.click(screen.getByTestId('candlestick-pattern-picker-button'));
      expect(screen.getByTestId('candlestick-pattern-picker-menu')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('candlestick-pattern-picker-backdrop'));

      expect(screen.queryByTestId('candlestick-pattern-picker-menu')).not.toBeInTheDocument();
    });

    test('a badge tooltip includes the matched bar\'s OHLC values, not just the pattern name', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      const dojiBadge = badges.find((b) => b.getAttribute('data-pattern') === 'doji')!;
      // Doji's bar is { open: 10, high: 12, low: 2, close: 10 }.
      expect(dojiBadge.getAttribute('title')).toContain('Doji —');
      expect(dojiBadge.getAttribute('title')).toMatch(/\$10\.00/);
      expect(dojiBadge.getAttribute('title')).toMatch(/\$12\.00/);
      expect(dojiBadge.getAttribute('title')).toMatch(/\$2\.00/);
    });

    test('the connecting line only appears while hovering its own badge, not by default or for other badges', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      expect(screen.queryByTestId('candlestick-pattern-connector')).not.toBeInTheDocument();

      const dojiBadge = badges.find((b) => b.getAttribute('data-pattern') === 'doji')!;
      await userEvent.hover(dojiBadge);
      expect(screen.getByTestId('candlestick-pattern-connector')).toBeInTheDocument();

      await userEvent.unhover(dojiBadge);
      expect(screen.queryByTestId('candlestick-pattern-connector')).not.toBeInTheDocument();
    });

    test('Doji-family badges sit on their own row, separate from the other 4 patterns (2026-09-26 follow-up)', async () => {
      mockRoutedFetch({ snapshot: PATTERN_SNAPSHOT });
      renderPopup();

      const badges = await screen.findAllByTestId('pattern-badge');
      const dojiFamily = ['doji', 'dragonflyDoji', 'gravestoneDoji', 'longLeggedDoji'];
      const theRest = ['hammer', 'shootingStar', 'marubozu', 'spinningTop', 'beltHold'];

      for (const badge of badges) {
        const pattern = badge.getAttribute('data-pattern')!;
        const expectedTop = dojiFamily.includes(pattern) ? '25%' : '75%';
        expect(theRest.includes(pattern) || dojiFamily.includes(pattern)).toBe(true);
        expect(badge).toHaveStyle({ top: expectedTop });
      }
    });
  });

  describe('Complex Pattern overlay (2026-09-27, on-demand)', () => {
    // Newest-first (API convention) - toChronological() reverses to [prev, curr], a valid
    // Bullish Engulfing (curr's body fully engulfs prev's).
    const BULLISH_ENGULFING_SNAPSHOT = {
      ...SNAPSHOT,
      bars: [
        { date: '2026-09-18', open: 8.5, high: 10.7, low: 8.3, close: 10.5, volume: 1000 }, // curr
        { date: '2026-09-17', open: 10, high: 10.2, low: 8.8, close: 9, volume: 900 }, // prev
      ],
    };

    // Complex-pattern badges share the exact same `pattern-badge` testid as the always-on simple
    // panel's own badges (both use CandlestickPatternBadge) - and since the 9 simple patterns run
    // unconditionally on every interval, a bar engineered to trigger a complex pattern can easily
    // ALSO independently trigger a simple one (found live while writing these tests: a Morning
    // Star's own completion candle also happened to qualify as a Belt Hold). Every query here is
    // scoped to `candlestick-complex-pattern-overlay` specifically to stay unambiguous regardless
    // of what the simple panel is also showing for the same bars.
    function complexOverlay() {
      return within(screen.getByTestId('candlestick-complex-pattern-overlay'));
    }

    test('the complex picker defaults to 0 shown, and the overlay renders no badges until one is checked', async () => {
      mockRoutedFetch({ snapshot: BULLISH_ENGULFING_SNAPSHOT });
      renderPopup();

      await screen.findByTestId('candlestick-complex-pattern-overlay');
      // 10 = the 2-candle tier only (expanded 2026-09-28 with Tweezer Bottom/Top then Bullish/
      // Bearish Kicking, was 6); the 4 three-candle patterns moved to their own Advanced picker
      // (2026-09-27) - see the Advanced Pattern panel describe block below.
      expect(screen.getByTestId('candlestick-complex-pattern-picker-button')).toHaveTextContent('0 of 10 shown');
      // 12 = the 3-candle tier expanded 2026-09-27 (was 4) with Three Inside/Outside Up/Down,
      // then 2026-09-29 with Bullish/Bearish Abandoned Baby (was 8) then Upside/Downside Tasuki
      // Gap (was 10).
      expect(screen.getByTestId('candlestick-advanced-pattern-picker-button')).toHaveTextContent('0 of 12 shown');
      expect(complexOverlay().queryByTestId('pattern-badge')).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishEngulfing').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bullishEngulfing');
      expect(badge).toHaveTextContent('E+');
    });

    test('a checked complex-pattern badge renders in its own strip below the simple pattern panel, not inside the price chart\'s own box', async () => {
      mockRoutedFetch({ snapshot: BULLISH_ENGULFING_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishEngulfing').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      const priceChart = screen.getByTestId('candlestick-price-chart');
      const simplePanel = screen.getByTestId('candlestick-pattern-panel');
      const overlay = screen.getByTestId('candlestick-complex-pattern-overlay');
      // 2026-09-27 follow-up: moved out of the price chart's own box entirely (a second
      // live-reported round of "the graph jerks" persisted even after the first hit-target fix -
      // see ComplexPatternPanel's own comment) into a standalone strip after PatternPanel, the
      // same non-overlapping-the-canvas placement PatternPanel itself already used.
      expect(priceChart).not.toContainElement(overlay);
      expect(overlay).toContainElement(badge);
      expect(
        simplePanel.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test('hovering a complex-pattern badge shows a connector extending upward (bottom-full), matching the simple panel\'s own connector direction', async () => {
      mockRoutedFetch({ snapshot: BULLISH_ENGULFING_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishEngulfing').querySelector('input')!);
      const badge = await complexOverlay().findByTestId('pattern-badge');

      expect(screen.queryByTestId('candlestick-complex-pattern-connector')).not.toBeInTheDocument();
      await userEvent.hover(badge);
      const connector = screen.getByTestId('candlestick-complex-pattern-connector');
      expect(connector.className).toContain('bottom-full');
      expect(connector.className).not.toContain('top-full');

      await userEvent.unhover(badge);
      expect(screen.queryByTestId('candlestick-complex-pattern-connector')).not.toBeInTheDocument();
    });

    test('Bearish Engulfing is detected and labeled correctly', async () => {
      const BEARISH_ENGULFING_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 10.5, high: 10.7, low: 8.3, close: 8.5, volume: 1000 },
          { date: '2026-09-17', open: 9, high: 10.2, low: 8.8, close: 10, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: BEARISH_ENGULFING_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bearishEngulfing').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bearishEngulfing');
      expect(badge).toHaveTextContent('E-');
    });

    test('Piercing Line is detected and labeled correctly', async () => {
      const PIERCING_LINE_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 14.5, high: 19.2, low: 14.3, close: 19, volume: 1000 },
          { date: '2026-09-17', open: 20, high: 20.3, low: 15, close: 16, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: PIERCING_LINE_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-piercingLine').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'piercingLine');
      expect(badge).toHaveTextContent('P+');
    });

    test('Dark Cloud Cover is detected and labeled correctly', async () => {
      const DARK_CLOUD_COVER_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 20.5, high: 20.7, low: 15.8, close: 16, volume: 1000 },
          { date: '2026-09-17', open: 15, high: 20, low: 14.7, close: 19, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: DARK_CLOUD_COVER_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-darkCloudCover').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'darkCloudCover');
      expect(badge).toHaveTextContent('P-');
    });

    test('Bullish Harami is detected and labeled correctly', async () => {
      const BULLISH_HARAMI_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 17, high: 18.5, low: 16.5, close: 18, volume: 1000 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 14.5, close: 15, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: BULLISH_HARAMI_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishHarami').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bullishHarami');
      expect(badge).toHaveTextContent('I+');
    });

    test('Bearish Harami is detected and labeled correctly', async () => {
      const BEARISH_HARAMI_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 18, high: 18.5, low: 16.5, close: 17, volume: 1000 },
          { date: '2026-09-17', open: 15, high: 20.5, low: 14.5, close: 20, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: BEARISH_HARAMI_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bearishHarami').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bearishHarami');
      expect(badge).toHaveTextContent('I-');
    });

    test('Tweezer Bottom is detected and labeled correctly', async () => {
      const TWEEZER_BOTTOM_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 15.2, high: 19, low: 15, close: 18.5, volume: 1000 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 15, close: 17, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: TWEEZER_BOTTOM_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-tweezerBottom').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'tweezerBottom');
      expect(badge).toHaveTextContent('Tb');
    });

    test('Tweezer Top is detected and labeled correctly', async () => {
      const TWEEZER_TOP_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 18.3, high: 20, low: 16, close: 16.5, volume: 1000 },
          { date: '2026-09-17', open: 15, high: 20, low: 14.5, close: 18, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: TWEEZER_TOP_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-tweezerTop').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'tweezerTop');
      expect(badge).toHaveTextContent('Tt');
    });

    test('Bullish Kicking is detected and labeled correctly', async () => {
      const BULLISH_KICKING_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 25, high: 30, low: 25, close: 30, volume: 1000 },
          { date: '2026-09-17', open: 20, high: 20, low: 15, close: 15, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: BULLISH_KICKING_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishKicking').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bullishKicking');
      expect(badge).toHaveTextContent('K+');
    });

    test('Bearish Kicking is detected and labeled correctly', async () => {
      const BEARISH_KICKING_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-18', open: 10, high: 10, low: 5, close: 5, volume: 1000 },
          { date: '2026-09-17', open: 15, high: 20, low: 15, close: 20, volume: 900 },
        ],
      };
      mockRoutedFetch({ snapshot: BEARISH_KICKING_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bearishKicking').querySelector('input')!);

      const badge = await complexOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bearishKicking');
      expect(badge).toHaveTextContent('K-');
    });
  });

  // Advanced = the 3-candle tier (2026-09-27). Split out of the single combined Complex picker
  // so a self-directed investor can opt into complexity at their own level - see
  // candlestickPatternDetection.ts's own comment on the candle-count rule. Structurally
  // identical to the Complex block above (same detectComplexPatterns pass, same badge/panel
  // mechanics); only which picker offers the pattern differs.
  describe('Advanced Pattern panel (2026-09-27, 3-candle tier)', () => {
    function advancedOverlay() {
      return within(screen.getByTestId('candlestick-advanced-pattern-overlay'));
    }

    test('Morning Star is detected and labeled correctly', async () => {
      const MORNING_STAR_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 14.5, high: 19.2, low: 14.3, close: 19, volume: 1000 },
          { date: '2026-09-18', open: 14, high: 14.5, low: 13.8, close: 14.3, volume: 900 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 15, close: 16, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: MORNING_STAR_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-morningStar').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'morningStar');
      expect(badge).toHaveTextContent('S+');
    });

    test('Bullish Abandoned Baby is detected and labeled correctly', async () => {
      const BULLISH_ABANDONED_BABY_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 13.6, high: 19.2, low: 13.5, close: 19, volume: 1000 },
          { date: '2026-09-18', open: 13, high: 13.3, low: 12.8, close: 13.2, volume: 900 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 15, close: 16, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: BULLISH_ABANDONED_BABY_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-bullishAbandonedBaby').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bullishAbandonedBaby');
      expect(badge).toHaveTextContent('A+');
    });

    test('Bearish Abandoned Baby is detected and labeled correctly', async () => {
      const BEARISH_ABANDONED_BABY_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 19.5, high: 19.7, low: 15.8, close: 16, volume: 1000 },
          { date: '2026-09-18', open: 20, high: 20.3, low: 19.8, close: 20.1, volume: 900 },
          { date: '2026-09-17', open: 15, high: 19.5, low: 14.5, close: 19, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: BEARISH_ABANDONED_BABY_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-bearishAbandonedBaby').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'bearishAbandonedBaby');
      expect(badge).toHaveTextContent('A-');
    });

    test('Upside Tasuki Gap is detected and labeled correctly', async () => {
      const UPSIDE_TASUKI_GAP_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 29, high: 29.5, low: 25.3, close: 25.5, volume: 1000 },
          { date: '2026-09-18', open: 27, high: 32, low: 26, close: 31, volume: 900 },
          { date: '2026-09-17', open: 20, high: 25.5, low: 19.5, close: 25, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: UPSIDE_TASUKI_GAP_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-upsideTasukiGap').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'upsideTasukiGap');
      expect(badge).toHaveTextContent('Gu');
    });

    test('Downside Tasuki Gap is detected and labeled correctly', async () => {
      const DOWNSIDE_TASUKI_GAP_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 16, high: 19.7, low: 15.5, close: 19.5, volume: 1000 },
          { date: '2026-09-18', open: 18, high: 19, low: 13, close: 14, volume: 900 },
          { date: '2026-09-17', open: 25, high: 25.5, low: 19.5, close: 20, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: DOWNSIDE_TASUKI_GAP_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-downsideTasukiGap').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'downsideTasukiGap');
      expect(badge).toHaveTextContent('Gd');
    });

    test('Evening Star is detected and labeled correctly', async () => {
      const EVENING_STAR_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 20.5, high: 20.7, low: 15.8, close: 16, volume: 1000 },
          { date: '2026-09-18', open: 20.5, high: 21, low: 20.3, close: 20.8, volume: 900 },
          { date: '2026-09-17', open: 15, high: 19.5, low: 14.5, close: 19, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: EVENING_STAR_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-eveningStar').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'eveningStar');
      expect(badge).toHaveTextContent('S-');
    });

    test('Three White Soldiers is detected and labeled correctly', async () => {
      const THREE_WHITE_SOLDIERS_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 12, high: 14.3, low: 11.8, close: 14, volume: 1000 },
          { date: '2026-09-18', open: 11, high: 13.3, low: 10.8, close: 13, volume: 900 },
          { date: '2026-09-17', open: 10, high: 12.2, low: 9.8, close: 12, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_WHITE_SOLDIERS_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeWhiteSoldiers').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeWhiteSoldiers');
      expect(badge).toHaveTextContent('3+');
    });

    test('Three Black Crows is detected and labeled correctly', async () => {
      const THREE_BLACK_CROWS_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 18, high: 18.2, low: 15.7, close: 16, volume: 1000 },
          { date: '2026-09-18', open: 19, high: 19.2, low: 16.7, close: 17, volume: 900 },
          { date: '2026-09-17', open: 20, high: 20.2, low: 17.8, close: 18, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_BLACK_CROWS_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeBlackCrows').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeBlackCrows');
      expect(badge).toHaveTextContent('3-');
    });

    test('Three Inside Up is detected and labeled correctly', async () => {
      const THREE_INSIDE_UP_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 18, high: 21, low: 17.8, close: 20.5, volume: 1000 },
          { date: '2026-09-18', open: 17, high: 18.5, low: 16.5, close: 18, volume: 900 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 14.5, close: 15, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_INSIDE_UP_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeInsideUp').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeInsideUp');
      expect(badge).toHaveTextContent('Iu');
    });

    test('Three Inside Down is detected and labeled correctly', async () => {
      const THREE_INSIDE_DOWN_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 17, high: 17.2, low: 14.3, close: 14.5, volume: 1000 },
          { date: '2026-09-18', open: 18, high: 18.5, low: 16.5, close: 17, volume: 900 },
          { date: '2026-09-17', open: 15, high: 20.5, low: 14.5, close: 20, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_INSIDE_DOWN_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeInsideDown').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeInsideDown');
      expect(badge).toHaveTextContent('Id');
    });

    test('Three Outside Up is detected and labeled correctly', async () => {
      const THREE_OUTSIDE_UP_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 10.6, high: 11.5, low: 10.4, close: 11.2, volume: 1000 },
          { date: '2026-09-18', open: 8.5, high: 10.7, low: 8.3, close: 10.5, volume: 900 },
          { date: '2026-09-17', open: 10, high: 10.2, low: 8.8, close: 9, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_OUTSIDE_UP_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeOutsideUp').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeOutsideUp');
      expect(badge).toHaveTextContent('Ou');
    });

    test('Three Outside Down is detected and labeled correctly', async () => {
      const THREE_OUTSIDE_DOWN_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-19', open: 8.4, high: 8.6, low: 7.5, close: 7.8, volume: 1000 },
          { date: '2026-09-18', open: 10.5, high: 10.7, low: 8.3, close: 8.5, volume: 900 },
          { date: '2026-09-17', open: 9, high: 10.2, low: 8.8, close: 10, volume: 800 },
        ],
      };
      mockRoutedFetch({ snapshot: THREE_OUTSIDE_DOWN_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-advanced-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-advanced-pattern-picker-option-threeOutsideDown').querySelector('input')!);

      const badge = await advancedOverlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'threeOutsideDown');
      expect(badge).toHaveTextContent('Od');
    });
  });

  describe('Complex (5-candle) panel (2026-10-03, the new 4th tier)', () => {
    function complex5Overlay() {
      return within(screen.getByTestId('candlestick-complex5-pattern-overlay'));
    }

    test('the picker defaults to 0 shown, listing both 5-candle patterns', async () => {
      mockRoutedFetch();
      renderPopup();

      await screen.findByTestId('candlestick-complex5-pattern-overlay');
      expect(screen.getByTestId('candlestick-complex5-pattern-picker-button')).toHaveTextContent('0 of 2 shown');
    });

    test('Rising Three Methods is detected and labeled correctly', async () => {
      const RISING_THREE_METHODS_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-21', open: 13, high: 22.5, low: 10, close: 22, volume: 1000 },
          { date: '2026-09-20', open: 14, high: 14.5, low: 11.5, close: 12, volume: 900 },
          { date: '2026-09-19', open: 16, high: 16.5, low: 13.5, close: 14, volume: 800 },
          { date: '2026-09-18', open: 18, high: 18.5, low: 15.5, close: 16, volume: 700 },
          { date: '2026-09-17', open: 10, high: 20.5, low: 9.5, close: 20, volume: 600 },
        ],
      };
      mockRoutedFetch({ snapshot: RISING_THREE_METHODS_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex5-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex5-pattern-picker-option-risingThreeMethods').querySelector('input')!);

      const badge = await complex5Overlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'risingThreeMethods');
      expect(badge).toHaveTextContent('Rm');
    });

    test('Falling Three Methods is detected and labeled correctly', async () => {
      const FALLING_THREE_METHODS_SNAPSHOT = {
        ...SNAPSHOT,
        bars: [
          { date: '2026-09-21', open: 17, high: 20, low: 7.5, close: 8, volume: 1000 },
          { date: '2026-09-20', open: 16, high: 18.5, low: 15.5, close: 18, volume: 900 },
          { date: '2026-09-19', open: 14, high: 16.5, low: 13.5, close: 16, volume: 800 },
          { date: '2026-09-18', open: 12, high: 14.5, low: 11.5, close: 14, volume: 700 },
          { date: '2026-09-17', open: 20, high: 20.5, low: 9.5, close: 10, volume: 600 },
        ],
      };
      mockRoutedFetch({ snapshot: FALLING_THREE_METHODS_SNAPSHOT });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex5-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex5-pattern-picker-option-fallingThreeMethods').querySelector('input')!);

      const badge = await complex5Overlay().findByTestId('pattern-badge');
      expect(badge).toHaveAttribute('data-pattern', 'fallingThreeMethods');
      expect(badge).toHaveTextContent('Fm');
    });

    test('the "All" checkbox selects both 5-candle patterns, and toggling it again clears back to empty', async () => {
      mockRoutedFetch();
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex5-pattern-picker-button'));
      const allCheckbox = screen.getByTestId('candlestick-complex5-pattern-picker-option-all').querySelector('input')!;
      expect(allCheckbox).not.toBeChecked();

      await userEvent.click(allCheckbox);
      expect(screen.getByTestId('candlestick-complex5-pattern-picker-button')).toHaveTextContent('2 of 2 shown');
      expect(allCheckbox).toBeChecked();

      await userEvent.click(allCheckbox);
      expect(screen.getByTestId('candlestick-complex5-pattern-picker-button')).toHaveTextContent('0 of 2 shown');
      expect(allCheckbox).not.toBeChecked();
    });
  });

  describe('UI tightening pass (2026-09-28)', () => {
    test('the 4 pattern pickers are grouped inside one enclosed box under a single "Pattern:" label', async () => {
      mockRoutedFetch();
      renderPopup();

      await screen.findByTestId('candlestick-pattern-tier-group');
      const group = within(screen.getByTestId('candlestick-pattern-tier-group'));
      expect(group.getByTestId('candlestick-pattern-picker-row')).toBeInTheDocument();
      expect(group.getByTestId('candlestick-complex-pattern-picker-row')).toBeInTheDocument();
      expect(group.getByTestId('candlestick-advanced-pattern-picker-row')).toBeInTheDocument();
      expect(group.getByTestId('candlestick-complex5-pattern-picker-row')).toBeInTheDocument();
      // Each row's own sub-label is now just its tier name, not a full "X Patterns:" description.
      expect(group.getByText('Simple')).toBeInTheDocument();
      expect(group.getByText('Composite')).toBeInTheDocument();
      expect(group.getByText('Advanced')).toBeInTheDocument();
      expect(group.getByText('Complex')).toBeInTheDocument();
    });

    test('the price chart and all 4 pattern strips are prefixed with their own tier label ("" for the chart itself)', async () => {
      mockRoutedFetch();
      renderPopup();

      await screen.findByTestId('candlestick-price-chart');
      // Exactly one of each - confirms TierLine's label column rendered once per line, not
      // duplicated between the picker group's own labels (checked above) and the strip prefixes.
      expect(screen.getAllByText('Simple')).toHaveLength(2); // picker sub-label + strip prefix
      expect(screen.getAllByText('Composite')).toHaveLength(2);
      expect(screen.getAllByText('Advanced')).toHaveLength(2);
      expect(screen.getAllByText('Complex')).toHaveLength(2);
    });

    test('each picker\'s "All" checkbox selects every pattern in that tier, and toggling it again clears back to empty', async () => {
      mockRoutedFetch();
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      const allCheckbox = screen.getByTestId('candlestick-complex-pattern-picker-option-all').querySelector('input')!;
      expect(allCheckbox).not.toBeChecked();

      await userEvent.click(allCheckbox);
      expect(screen.getByTestId('candlestick-complex-pattern-picker-button')).toHaveTextContent('10 of 10 shown');
      expect(allCheckbox).toBeChecked();

      await userEvent.click(allCheckbox);
      expect(screen.getByTestId('candlestick-complex-pattern-picker-button')).toHaveTextContent('0 of 10 shown');
      expect(allCheckbox).not.toBeChecked();
    });

    test('the always-on Simple picker\'s "All" checkbox starts checked, since every simple pattern is visible by default', async () => {
      mockRoutedFetch();
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-pattern-picker-button'));
      expect(screen.getByTestId('candlestick-pattern-picker-option-all').querySelector('input')!).toBeChecked();
    });
  });

  describe('Symbol Switcher (2026-09-28, in-popup symbol switching)', () => {
    const MSFT_SNAPSHOT = { ...SNAPSHOT, companyName: 'Microsoft Corp.' };
    const CACHED_SYMBOLS = {
      symbols: [
        { symbol: 'AAPL', interval: '1day', updatedAt: '2026-09-28T13:00:00Z', isFresh: true },
        { symbol: 'MSFT', interval: '1day', updatedAt: '2026-09-20T13:00:00Z', isFresh: false },
      ],
    };

    test('the trigger shows the active symbol, and opening it lists the cached symbols with correct fresh/stale styling', async () => {
      mockRoutedFetch({ cachedSymbols: CACHED_SYMBOLS });
      renderPopup();

      const trigger = await screen.findByTestId('candlestick-symbol-switcher-button');
      expect(trigger).toHaveTextContent('AAPL');

      await userEvent.click(trigger);
      const aaplRow = await screen.findByTestId('candlestick-symbol-switcher-row-AAPL');
      const msftRow = screen.getByTestId('candlestick-symbol-switcher-row-MSFT');
      expect(aaplRow.className).toContain('bg-success/10');
      expect(msftRow.className).toContain('bg-border');
    });

    test('clicking a cached row switches the active symbol and re-fetches its own snapshot', async () => {
      mockRoutedFetch({ cachedSymbols: CACHED_SYMBOLS, otherSymbolSnapshots: { MSFT: MSFT_SNAPSHOT } });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-symbol-switcher-button'));
      await userEvent.click(await screen.findByTestId('candlestick-symbol-switcher-row-MSFT'));

      expect(await screen.findByTestId('candlestick-symbol-switcher-button')).toHaveTextContent('MSFT');
      expect(await screen.findByTestId('candlestick-company-name')).toHaveTextContent('Microsoft Corp.');
      // The dropdown closes after a selection, same as every other picker in this popup.
      expect(screen.queryByTestId('candlestick-symbol-switcher-menu')).not.toBeInTheDocument();
    });

    test('typing and submitting a brand-new symbol in the switcher\'s own input also switches the active symbol', async () => {
      mockRoutedFetch({ cachedSymbols: CACHED_SYMBOLS, otherSymbolSnapshots: { MSFT: MSFT_SNAPSHOT } });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-symbol-switcher-button'));
      await userEvent.type(screen.getByTestId('candlestick-symbol-switcher-new-symbol-input'), 'msft');
      await userEvent.click(screen.getByTestId('candlestick-symbol-switcher-new-symbol-go'));

      expect(await screen.findByTestId('candlestick-symbol-switcher-button')).toHaveTextContent('MSFT');
      expect(await screen.findByTestId('candlestick-company-name')).toHaveTextContent('Microsoft Corp.');
    });

    test('switching symbols preserves the currently selected interval, active indicators, and pattern-picker selections', async () => {
      mockRoutedFetch({ cachedSymbols: CACHED_SYMBOLS, otherSymbolSnapshots: { MSFT: MSFT_SNAPSHOT } }, '30min');
      renderPopup({ initialInterval: '30min' });

      await screen.findByTestId('candlestick-price-chart');
      await userEvent.click(screen.getByTestId('candlestick-interval-30min'));
      await userEvent.click(await screen.findByTestId('candlestick-complex-pattern-picker-button'));
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishEngulfing').querySelector('input')!);
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-button')); // close the picker

      await userEvent.click(screen.getByTestId('candlestick-symbol-switcher-button'));
      await userEvent.click(screen.getByTestId('candlestick-symbol-switcher-row-MSFT'));

      await screen.findByTestId('candlestick-company-name');
      expect(screen.getByTestId('candlestick-interval-30min').className).toContain('bg-accent');
      await userEvent.click(screen.getByTestId('candlestick-complex-pattern-picker-button'));
      expect(screen.getByTestId('candlestick-complex-pattern-picker-option-bullishEngulfing').querySelector('input')!).toBeChecked();
    });

    test('a symbol with no cached data at the current interval falls through to the existing confirm-to-fetch prompt', async () => {
      mockRoutedFetch({ cachedSymbols: CACHED_SYMBOLS, otherSymbolSnapshots: {} });
      renderPopup();

      await userEvent.click(await screen.findByTestId('candlestick-symbol-switcher-button'));
      await userEvent.click(await screen.findByTestId('candlestick-symbol-switcher-row-MSFT'));

      expect(await screen.findByTestId('candlestick-confirm-fetch')).toBeInTheDocument();
    });
  });
});
