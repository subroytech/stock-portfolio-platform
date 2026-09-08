import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import UsageAuditPage from './UsageAuditPage';

const LAST_3_DAYS_RANKING = [
  {
    userId: 'u1', email: 'heavy@b.com', totalFunctionCalls: 6, totalFmpCalls: 125, totalFinnhubCalls: 3,
    byFeature: {
      contrarian_finder_scan: { functionCalls: 3, fmpCalls: 125, finnhubCalls: 0 },
      momentum: { functionCalls: 3, fmpCalls: 0, finnhubCalls: 3 },
    },
  },
  { userId: 'u2', email: 'light@b.com', totalFunctionCalls: 2, totalFmpCalls: 2, totalFinnhubCalls: 0, byFeature: { momentum: { functionCalls: 2, fmpCalls: 2, finnhubCalls: 0 } } },
  { userId: 'u3', email: 'idle@b.com', totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} },
];

const AUGUST_RANKING = [
  { userId: 'u2', email: 'light@b.com', totalFunctionCalls: 4, totalFmpCalls: 40, totalFinnhubCalls: 0, byFeature: { long_term_analysis: { functionCalls: 4, fmpCalls: 40, finnhubCalls: 0 } } },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsageAuditPage />
    </QueryClientProvider>,
  );
}

function mockFetch() {
  return vi.spyOn(client, 'apiFetch').mockImplementation((path: string) => {
    if (path === '/usage-audit/last-3-days') return Promise.resolve({ ranking: LAST_3_DAYS_RANKING });
    if (path.startsWith('/usage-audit/monthly')) {
      if (path.includes('2026-08-01')) return Promise.resolve({ month: '2026-08-01', ranking: AUGUST_RANKING, dataCutoff: '2026-08-28T10:00:00.000Z' });
      return Promise.resolve({ month: '2026-09-01', ranking: [], dataCutoff: '2026-09-04T10:00:00.000Z' });
    }
    if (path === '/usage-audit/available-months') return Promise.resolve({ months: ['2026-08-01', '2026-07-01'] });
    return Promise.reject(new Error(`unexpected call ${path}`));
  });
}

describe('UsageAuditPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('defaults to the Last 3 Days sub-tab, ranked by combined FMP+Finnhub call volume', async () => {
    mockFetch();
    renderPage();

    expect(screen.getByRole('button', { name: 'Last 3 Days' })).toHaveClass('bg-accent');
    await screen.findByText('heavy@b.com');

    const rows = screen.getAllByTestId(/^usage-row-/);
    expect(rows[0]).toHaveTextContent('heavy@b.com');
    expect(rows[1]).toHaveTextContent('light@b.com');
    expect(rows[2]).toHaveTextContent('idle@b.com');
    expect(screen.getByTestId('usage-function-calls-u1')).toHaveTextContent('6');
    expect(screen.getByTestId('usage-fmp-calls-u1')).toHaveTextContent('125');
    expect(screen.getByTestId('usage-finnhub-calls-u1')).toHaveTextContent('3');
  });

  test('a zero-usage user still appears, at the bottom', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('idle@b.com');
    expect(screen.getByTestId('usage-function-calls-u3')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-fmp-calls-u3')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-finnhub-calls-u3')).toHaveTextContent('0');
  });

  test('clicking a row expands its per-feature breakdown, showing all three numbers per feature', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('heavy@b.com');

    expect(screen.queryByTestId('usage-breakdown-u1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('heavy@b.com'));

    const breakdown = screen.getByTestId('usage-breakdown-u1');
    expect(breakdown).toHaveTextContent('Contrarian Finder');
    expect(breakdown).toHaveTextContent('125');
    expect(breakdown).toHaveTextContent('Momentum Analysis');
    expect(breakdown).toHaveTextContent('3');
  });

  test('switching to Monthly shows a month picker defaulting to the current month', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('heavy@b.com');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await waitFor(() => expect(screen.getByLabelText('Select month')).toBeInTheDocument());
    expect(screen.getByText('No usage recorded for this month.')).toBeInTheDocument();
  });

  test('Monthly shows a banner reflecting the sweep\'s data cutoff', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('heavy@b.com');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    const banner = await screen.findByTestId('usage-monthly-cutoff-banner');
    expect(banner).toHaveTextContent('cumulative call details until');
  });

  test('picking a past month loads and shows that month\'s ranking', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('heavy@b.com');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await screen.findByLabelText('Select month');

    await userEvent.selectOptions(screen.getByLabelText('Select month'), '2026-08-01');
    expect(await screen.findByText('light@b.com')).toBeInTheDocument();
    expect(screen.getByTestId('usage-fmp-calls-u2')).toHaveTextContent('40');
  });
});
