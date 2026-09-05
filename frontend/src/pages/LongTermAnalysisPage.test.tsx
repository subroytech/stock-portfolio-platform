import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import LongTermAnalysisPage from './LongTermAnalysisPage';
import type { LongTermAnalysisResult } from '../api/longTermAnalysis';

// A fresh QueryClient per render — the app's shared singleton would leak
// cached mutation state between these tests.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LongTermAnalysisPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function baseResult(symbol = 'AAPL'): LongTermAnalysisResult {
  return {
    symbol,
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    exchange: 'NASDAQ',
    price: 200,
    marketCap: 3_000_000_000_000,
    beta: 1.2,
    range52w: '150.00-220.00',
    dividend: 1,
    valuation: { trailingPe: 20, forwardPe: 18, evToEbitda: 22, peerAvgTrailingPe: 25, peerAvgEvToEbitda: 20, peerCount: 1 },
    financials: {
      fyLabel: 'FY2026',
      fyPrevLabel: 'FY2025',
      revenue: { current: 1100, prior: 1000, yoyPct: 10 },
      grossMargin: { current: 50, prior: 50, deltaPp: 0 },
      operatingMargin: { current: 20, prior: 20, deltaPp: 0 },
      eps: { current: 6, prior: 5, yoyPct: 20 },
      netIncomeGrowthPct: 33.3,
    },
    earningsSurprises: [{ date: '2026-06-30', epsActual: 1.6, epsEstimated: 1.5 }],
    priceTarget: { targetConsensus: 230, targetHigh: 260, targetLow: 190 },
    upsidePct: 15,
    consensus: { strongBuy: 1, buy: 1, hold: 0, sell: 0, strongSell: 0, totalAnalysts: 2, buyPct: 100, holdPct: 0, sellPct: 0 },
    peers: [{ symbol: 'MSFT', price: 400, trailingPe: 30, evToEbitda: 20, marketCap: 3_000_000_000_000 }],
    peerNote: 'Sector peers sourced live from FMP.',
    bullSignals: ['Revenue growth of +10.0% YoY demonstrates strong top-line momentum.'],
    bearSignals: [],
    mediumTerm: { rating: 'bullish', score: 5, rationale: 'Strong medium-term picture.' },
    longTerm: { rating: 'bullish', score: 6, rationale: 'Strong long-term picture.' },
    news: [{ date: '2026-07-20', title: 'Apple announces new product', source: 'Reuters', url: 'https://example.com' }],
  };
}

describe('LongTermAnalysisPage', () => {
  // The sub-tab history persists to sessionStorage (see lib/tickerHistory.ts) -
  // clear it between tests so one test's inserted ticker doesn't leak into
  // the next as an already-cached sub-tab. Mocks are restored too, since some
  // tests below assert exact call counts on the shared apiFetch spy.
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  test('submits a ticker and renders the analysis result', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseResult());
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'aapl');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

    expect((await screen.findAllByText('AAPL')).length).toBeGreaterThan(0); // snapshot heading + its own sub-tab
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/long-term/AAPL');
    expect(screen.getByText('Medium Term — 12 to 18 Months')).toBeInTheDocument();
    expect(screen.getByText('Long Term — 3 Years and Beyond')).toBeInTheDocument();
    expect(screen.getByText('Strong medium-term picture.')).toBeInTheDocument();
    expect(screen.getByText('Revenue growth of +10.0% YoY demonstrates strong top-line momentum.')).toBeInTheDocument();
  });

  test('renders the ApiError message on failure', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(503, 'No fmp API key on file.', null));
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

    await waitFor(() => expect(screen.getByText('No fmp API key on file.')).toBeInTheDocument());
  });

  test('a 404 shows "Invalid Stock ticker" and creates no sub-tab', async () => {
    vi.spyOn(client, 'apiFetch').mockRejectedValue(new ApiError(404, 'No data returned for ZZZZ.', null));
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

    await waitFor(() => expect(screen.getByText('Invalid Stock ticker')).toBeInTheDocument());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  test('revisiting an already-analyzed ticker shows the cached result without re-fetching', async () => {
    const fetchSpy = vi.spyOn(client, 'apiFetch').mockResolvedValueOnce(baseResult('AAPL'));
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));
    await screen.findByText('Medium Term — 12 to 18 Months');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Submit the same ticker again — should hit the cached sub-tab, not fetch again.
    await userEvent.clear(screen.getByLabelText('Ticker'));
    await userEvent.type(screen.getByLabelText('Ticker'), 'AAPL');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Medium Term — 12 to 18 Months')).toBeInTheDocument();
  });

  test('a 16th new ticker evicts the oldest sub-tab, keeping the list capped at 15', async () => {
    const seededEntries = Array.from({ length: 15 }, (_, i) => ({
      symbol: `SYM${i}`,
      data: baseResult(`SYM${i}`),
    }));
    sessionStorage.setItem('longTermAnalysis:history', JSON.stringify({ entries: seededEntries, activeSymbol: 'SYM0' }));
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseResult('NEWCO'));
    renderPage();

    expect(screen.getAllByRole('tab')).toHaveLength(15);
    expect(screen.getByText('SYM14')).toBeInTheDocument(); // the oldest, still present before the new insert

    await userEvent.type(screen.getByLabelText('Ticker'), 'NEWCO');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));
    await screen.findByText('Medium Term — 12 to 18 Months');

    expect(screen.getAllByRole('tab')).toHaveLength(15);
    expect(screen.queryByText('SYM14')).not.toBeInTheDocument(); // evicted
  });

  test('closing a sub-tab removes it with no gap left in the remaining list', async () => {
    const seededEntries = [
      { symbol: 'AAA', data: baseResult('AAA') },
      { symbol: 'BBB', data: baseResult('BBB') },
      { symbol: 'CCC', data: baseResult('CCC') },
    ];
    sessionStorage.setItem('longTermAnalysis:history', JSON.stringify({ entries: seededEntries, activeSymbol: 'AAA' }));
    renderPage();

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Close BBB' }));

    const remaining = screen.getAllByRole('tab');
    expect(remaining).toHaveLength(2);
    expect(screen.queryByText('BBB')).not.toBeInTheDocument();
  });
});
