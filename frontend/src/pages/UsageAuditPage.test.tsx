import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import UsageAuditPage from './UsageAuditPage';

const LAST_3_DAYS_RANKING = [
  {
    userId: 'u1', email: 'heavy@b.com', roles: ['user'], totalFunctionCalls: 6, totalFmpCalls: 125, totalFinnhubCalls: 3,
    byFeature: {
      contrarian_finder_scan: { functionCalls: 3, fmpCalls: 125, finnhubCalls: 0 },
      momentum: { functionCalls: 3, fmpCalls: 0, finnhubCalls: 3 },
    },
  },
  { userId: 'u2', email: 'boss@b.com', roles: ['admin-master'], totalFunctionCalls: 2, totalFmpCalls: 2, totalFinnhubCalls: 0, byFeature: { momentum: { functionCalls: 2, fmpCalls: 2, finnhubCalls: 0 } } },
  { userId: 'u3', email: 'idle@b.com', roles: ['user'], totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} },
];

const TODAY_RANKING = [
  { userId: 'u4', email: 'todayuser@b.com', roles: ['user'], totalFunctionCalls: 1, totalFmpCalls: 50, totalFinnhubCalls: 0, byFeature: {} },
];

const AUGUST_RANKING = [
  { userId: 'u2', email: 'boss@b.com', roles: ['admin-master'], totalFunctionCalls: 4, totalFmpCalls: 40, totalFinnhubCalls: 0, byFeature: { long_term_analysis: { functionCalls: 4, fmpCalls: 40, finnhubCalls: 0 } } },
  { userId: 'u5', email: 'augustuser@b.com', roles: ['user'], totalFunctionCalls: 2, totalFmpCalls: 20, totalFinnhubCalls: 0, byFeature: {} },
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
    if (path === '/usage-audit/day?offset=0') return Promise.resolve({ offset: 0, ranking: TODAY_RANKING });
    if (path === '/usage-audit/day?offset=1') return Promise.resolve({ offset: 1, ranking: [] });
    if (path === '/usage-audit/day?offset=2') return Promise.resolve({ offset: 2, ranking: [] });
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

  test('defaults to the Dashboard sub-tab', async () => {
    mockFetch();
    renderPage();

    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveClass('bg-accent');
    expect(await screen.findByText('Non-Admin Users')).toBeInTheDocument();
    expect(screen.getByText('Admin / Admin-Master')).toBeInTheDocument();
  });

  test('each of the 6 Dashboard cards defaults independently: pie-1 to Last 3 Days, monthly pie to the current month, bar to Last 3 Days', async () => {
    mockFetch();
    renderPage();

    const nonAdminPieDay = within(screen.getByTestId('dashboard-nonadmin-pie-day'));
    expect(await nonAdminPieDay.findByText('heavy@b.com')).toBeInTheDocument();

    const adminPieDay = within(screen.getByTestId('dashboard-admin-pie-day'));
    expect(await adminPieDay.findByText('boss@b.com')).toBeInTheDocument();

    // Bar chart groups by function, not by user - heavy@b.com's contrarian_finder_scan calls
    // are what should surface here, not their email.
    const nonAdminBar = within(screen.getByTestId('dashboard-nonadmin-bar'));
    expect(await nonAdminBar.findByText('Contrarian Finder')).toBeInTheDocument();

    // Current month (September) has an empty ranking per the mock, so both monthly pies show
    // their empty-state message.
    const nonAdminMonthly = within(screen.getByTestId('dashboard-nonadmin-monthly'));
    expect(await nonAdminMonthly.findByText('No API call activity for non-admin users this month.')).toBeInTheDocument();
  });

  test('the pie-1 period picker is independent per row - switching Non-Admin to Today never touches the Admin row', async () => {
    mockFetch();
    renderPage();
    const nonAdminCard = within(screen.getByTestId('dashboard-nonadmin-pie-day'));
    await nonAdminCard.findByText('heavy@b.com');

    await userEvent.selectOptions(nonAdminCard.getByLabelText('Select period'), 'today');

    await waitFor(() => expect(nonAdminCard.getByText('todayuser@b.com')).toBeInTheDocument());
    expect(nonAdminCard.queryByText('heavy@b.com')).not.toBeInTheDocument();

    // Admin row's own pie-1 card is untouched - still showing its Last 3 Days data.
    const adminCard = within(screen.getByTestId('dashboard-admin-pie-day'));
    expect(adminCard.getByText('boss@b.com')).toBeInTheDocument();
  });

  test('the monthly pie picker is independent per row', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Non-Admin Users');

    const nonAdminMonthly = within(screen.getByTestId('dashboard-nonadmin-monthly'));
    const adminMonthly = within(screen.getByTestId('dashboard-admin-monthly'));

    // Wait for the available-months fetch to populate the <option> list before selecting one.
    await waitFor(() => expect(nonAdminMonthly.getByText('August 2026')).toBeInTheDocument());

    await userEvent.selectOptions(nonAdminMonthly.getByLabelText('Select month'), '2026-08-01');
    await waitFor(() => expect(nonAdminMonthly.getByText('augustuser@b.com')).toBeInTheDocument());

    // Admin row's monthly card is still on September (empty), unaffected by the other card.
    expect(await adminMonthly.findByText('No API call activity for Admin/Admin-Master users this month.')).toBeInTheDocument();
  });

  test('the bar chart\'s combined selector can switch from a day-based option to a specific month', async () => {
    mockFetch();
    renderPage();
    const adminBar = within(screen.getByTestId('dashboard-admin-bar'));
    // Last 3 Days: boss@b.com's only activity is momentum.
    await adminBar.findByText('Momentum Analysis');

    await userEvent.selectOptions(adminBar.getByLabelText('Select period or month'), 'month:2026-08-01');

    // August: boss@b.com's activity is long_term_analysis instead - confirm the card switched
    // to the new period's feature breakdown, not still showing Last 3 Days'.
    await waitFor(() => expect(adminBar.getByText('Long-Term Analysis')).toBeInTheDocument());
    expect(adminBar.queryByText('Momentum Analysis')).not.toBeInTheDocument();
  });

  test('Last 3 Days sub-tab still ranks by combined FMP+Finnhub call volume', async () => {
    mockFetch();
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Last 3 Days' }));
    await screen.findByText('heavy@b.com');

    const rows = screen.getAllByTestId(/^usage-row-/);
    expect(rows[0]).toHaveTextContent('heavy@b.com');
    expect(rows[1]).toHaveTextContent('boss@b.com');
    expect(rows[2]).toHaveTextContent('idle@b.com');
    expect(screen.getByTestId('usage-function-calls-u1')).toHaveTextContent('6');
    expect(screen.getByTestId('usage-fmp-calls-u1')).toHaveTextContent('125');
    expect(screen.getByTestId('usage-finnhub-calls-u1')).toHaveTextContent('3');
  });

  test('a zero-usage user still appears, at the bottom, in the Last 3 Days list', async () => {
    mockFetch();
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Last 3 Days' }));
    await screen.findByText('idle@b.com');
    expect(screen.getByTestId('usage-function-calls-u3')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-fmp-calls-u3')).toHaveTextContent('0');
    expect(screen.getByTestId('usage-finnhub-calls-u3')).toHaveTextContent('0');
  });

  test('clicking a row expands its per-feature breakdown, showing all three numbers per feature', async () => {
    mockFetch();
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Last 3 Days' }));
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
    await screen.findByText('Non-Admin Users');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await waitFor(() => expect(screen.getByLabelText('Select month')).toBeInTheDocument());
    expect(screen.getByText('No usage recorded for this month.')).toBeInTheDocument();
  });

  test('Monthly shows a banner reflecting the sweep\'s data cutoff', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Non-Admin Users');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    const banner = await screen.findByTestId('usage-monthly-cutoff-banner');
    expect(banner).toHaveTextContent('cumulative call details until');
  });

  test('picking a past month on the Monthly list sub-tab loads and shows that month\'s ranking', async () => {
    mockFetch();
    renderPage();
    await screen.findByText('Non-Admin Users');

    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await screen.findByLabelText('Select month');

    await userEvent.selectOptions(screen.getByLabelText('Select month'), '2026-08-01');
    expect(await screen.findByText('boss@b.com')).toBeInTheDocument();
    expect(screen.getByTestId('usage-fmp-calls-u2')).toHaveTextContent('40');
  });
});
