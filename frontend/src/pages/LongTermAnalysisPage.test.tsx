import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
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

function baseResult(): LongTermAnalysisResult {
  return {
    symbol: 'AAPL',
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
  test('submits a ticker and renders the analysis result', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue(baseResult());
    renderPage();

    await userEvent.type(screen.getByLabelText('Ticker'), 'aapl');
    await userEvent.click(screen.getByRole('button', { name: /analyze/i }));

    expect(await screen.findByText('AAPL')).toBeInTheDocument();
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
});
