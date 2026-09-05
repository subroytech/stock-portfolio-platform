import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import DashboardPage from './DashboardPage';
import type { PortfolioDetail } from '../api/portfolios';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function basePortfolio(overrides: Partial<PortfolioDetail> = {}): PortfolioDetail {
  return {
    id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1',
    uploadTemplateId: null, flexTemplateStatus: null,
    cashAmount: 0, totalHoldingsValue: 1500, totalCostBasis: 1000, totalGainLoss: 500, totalPortfolioValue: 1500,
    holdings: [
      {
        id: 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, purchasePrice: 100, currentPrice: 150,
        sector: 'Technology', purchaseDate: null, costBasis: 1000, currentValue: 1500, gainLoss: 500,
        returnPct: 50, allocationPct: 100, priceUpdatedAt: '2026-07-15T10:00:00Z',
        todayChangeDollar: null, todayChangePercent: null,
      },
    ],
    ...overrides,
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('shows a "Prices as of" banner using the oldest priceUpdatedAt across holdings', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [{ id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1' }] });
      if (url === '/portfolios/1') return Promise.resolve({ portfolio: basePortfolio() });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
    expect(await screen.findByText(/prices as of/i)).toBeInTheDocument();
  });

  test('shows no "Prices as of" banner when no holding has ever been refreshed', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [{ id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1' }] });
      if (url === '/portfolios/1') {
        return Promise.resolve({
          portfolio: basePortfolio({
            holdings: [{ ...basePortfolio().holdings[0], priceUpdatedAt: null }],
          }),
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
    await screen.findByText('Holdings');
    expect(screen.queryByText(/prices as of/i)).not.toBeInTheDocument();
  });

  test('Refresh Prices response (holdings + performanceHistory) flows down to unlock the Performance widget\'s period tabs', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [{ id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1' }] });
      if (url === '/portfolios/1') return Promise.resolve({ portfolio: basePortfolio() });
      if (url === '/portfolios/1/refresh-prices' && options?.method === 'POST') {
        return Promise.resolve({
          holdings: [{
            id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50,
            allocationPct: 100, priceUpdatedAt: '2026-07-20T10:00:00Z', todayChangeDollar: 10, todayChangePercent: 1,
          }],
          performanceHistory: {
            AAPL: Array.from({ length: 30 }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, close: 150 - i, low: 149 - i })),
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
    await screen.findByText('Holdings');

    // Before any refresh: Performance shows the static fallback, no period tabs.
    expect(screen.queryByRole('button', { name: '1D' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /refresh prices/i }));

    expect(await screen.findByRole('button', { name: '1D' })).toBeInTheDocument();
  });

  test('the "Prices as of" banner picks up the new timestamp after Refresh Prices, via the invalidated portfolio refetch', async () => {
    let portfolioFetchCount = 0;
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [{ id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1' }] });
      if (url === '/portfolios/1') {
        portfolioFetchCount += 1;
        // First fetch (before any refresh): stale timestamp. Every fetch
        // after that (i.e. the refetch triggered by useRefreshPrices'
        // onSuccess invalidation) reflects what the real backend would
        // return post-refresh: the fresh timestamp.
        const priceUpdatedAt = portfolioFetchCount === 1 ? '2026-07-15T10:00:00Z' : '2026-07-20T10:00:00Z';
        return Promise.resolve({ portfolio: basePortfolio({ holdings: [{ ...basePortfolio().holdings[0], priceUpdatedAt }] }) });
      }
      if (url === '/portfolios/1/refresh-prices' && options?.method === 'POST') {
        return Promise.resolve({
          holdings: [{
            id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50,
            allocationPct: 100, priceUpdatedAt: '2026-07-20T10:00:00Z', todayChangeDollar: 10, todayChangePercent: 1,
          }],
          performanceHistory: {},
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
    const bannerBefore = await screen.findByText(/prices as of/i);
    expect(bannerBefore.textContent).toMatch(/Jul 15, 2026/);

    await userEvent.click(screen.getByRole('button', { name: /refresh prices/i }));

    await screen.findByText((_, el) => el?.tagName === 'P' && /prices as of/i.test(el.textContent ?? '') && /Jul 20, 2026/.test(el.textContent ?? ''));
  });

  test('switching portfolios does not leak one portfolio\'s refreshed period-tab data into another\'s view (Part B fix)', async () => {
    const portfolioA = basePortfolio({ id: '1', name: 'Fidelity' });
    const portfolioB = basePortfolio({
      id: '2', name: 'Schwab',
      holdings: [{
        id: 'h2', symbol: 'MSFT', name: 'Microsoft', quantity: 5, purchasePrice: 200, currentPrice: 250,
        sector: 'Technology', purchaseDate: null, costBasis: 1000, currentValue: 1250, gainLoss: 250,
        returnPct: 25, allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: null, todayChangePercent: null,
      }],
    });
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios') {
        return Promise.resolve({
          portfolios: [
            { id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1' },
            { id: '2', name: 'Schwab', broker: null, createdAt: 't1', updatedAt: 't1' },
          ],
        });
      }
      if (url === '/portfolios/1') return Promise.resolve({ portfolio: portfolioA });
      if (url === '/portfolios/2') return Promise.resolve({ portfolio: portfolioB });
      if (url === '/portfolios/1/refresh-prices' && options?.method === 'POST') {
        return Promise.resolve({
          holdings: [{
            id: 'h1', symbol: 'AAPL', currentPrice: 150, currentValue: 1500, gainLoss: 500, returnPct: 50,
            allocationPct: 100, priceUpdatedAt: '2026-07-20T10:00:00Z', todayChangeDollar: 10, todayChangePercent: 1,
          }],
          performanceHistory: {
            AAPL: Array.from({ length: 30 }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, close: 150 - i, low: 149 - i })),
          },
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    // Refresh Portfolio A - unlocks its rich period-tab view.
    await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
    await userEvent.click(screen.getByRole('button', { name: /refresh prices/i }));
    expect(await screen.findByRole('button', { name: '1D' })).toBeInTheDocument();

    // Switch to Portfolio B (never refreshed, different symbol entirely) -
    // must NOT show A's leaked data; must fall back to the static view.
    await userEvent.click(screen.getByRole('button', { name: 'Schwab' }));
    await screen.findByTestId('holdings-row-MSFT');
    expect(screen.queryByRole('button', { name: '1D' })).not.toBeInTheDocument();

    // Switch back to Portfolio A - its own refreshed data must be restored,
    // not lost (the bug this test guards against).
    await userEvent.click(screen.getByRole('button', { name: 'Fidelity' }));
    expect(await screen.findByRole('button', { name: '1D' })).toBeInTheDocument();
  });
});
