import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import TabShell from './TabShell';

function renderShell(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TabShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TabShell', () => {
  beforeEach(() => {
    // Dashboard's PortfolioSelector fires an unconditional /portfolios list
    // query the moment it mounts - every other tab only fetches on explicit
    // user action (useMutation), so a generic empty fallback covers the rest.
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      return Promise.resolve({});
    });
  });

  test('renders all 5 tab links, the API Keys button, and Log out', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Stock Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Long-Term Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contrarian Finder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contrarian Comeback' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Momentum Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'API Keys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  test('every tab panel is mounted from the start, only the active one is visible', () => {
    renderShell('/momentum');
    expect(screen.getByTestId('tab-panel-portfolio')).toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-momentum')).not.toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-contrarian-finder')).toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-long-term-analysis')).toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-contrarian-comeback')).toHaveClass('hidden');
  });

  test('switching away from a tab and back preserves its in-progress state', async () => {
    renderShell('/momentum');

    const momentumTicker = within(screen.getByTestId('tab-panel-momentum')).getByLabelText('Ticker');
    await userEvent.type(momentumTicker, 'AAPL');
    expect(momentumTicker).toHaveValue('AAPL');

    await userEvent.click(screen.getByRole('link', { name: 'Contrarian Finder' }));
    expect(screen.getByTestId('tab-panel-momentum')).toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-contrarian-finder')).not.toHaveClass('hidden');

    await userEvent.click(screen.getByRole('link', { name: 'Momentum Analysis' }));
    expect(screen.getByTestId('tab-panel-momentum')).not.toHaveClass('hidden');
    // Same input element, never unmounted - the typed value is still there.
    expect(within(screen.getByTestId('tab-panel-momentum')).getByLabelText('Ticker')).toHaveValue('AAPL');
  });

  test('each tab link points at its own URL and switches the visible panel on click', async () => {
    renderShell('/');
    expect(screen.getByRole('link', { name: 'Long-Term Analysis' })).toHaveAttribute('href', '/long-term-analysis');

    await userEvent.click(screen.getByRole('link', { name: 'Long-Term Analysis' }));
    expect(screen.getByTestId('tab-panel-long-term-analysis')).not.toHaveClass('hidden');
    expect(screen.getByTestId('tab-panel-portfolio')).toHaveClass('hidden');
  });

  test('the active tab link is styled differently from inactive ones', () => {
    renderShell('/contrarian-comeback');
    expect(screen.getByRole('link', { name: 'Contrarian Comeback' })).toHaveClass('bg-accent');
    expect(screen.getByRole('link', { name: 'Momentum Analysis' })).not.toHaveClass('bg-accent');
  });

  test('API Keys button opens the modal, and Close dismisses it', async () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'API Keys' }));
    expect(await screen.findByText('FMP (Financial Modeling Prep)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('FMP (Financial Modeling Prep)')).not.toBeInTheDocument();
  });

  function mockScanBatch() {
    return Promise.resolve({
      batchIndex: 0, totalBatches: 1, universeSize: 1,
      results: [{ symbol: 'AAA', filterFail: false, changePct: -30 }],
    });
  }

  test("a Contrarian Finder candidate row's LT button launches Long-Term Analysis with that ticker", async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      if (url === '/contrarian-finder/scan-batch') return mockScanBatch();
      if (url.startsWith('/analysis/long-term/')) return new Promise(() => {}); // left pending - only firing/handoff matters here
      return Promise.resolve({});
    });

    renderShell('/contrarian-finder');
    await userEvent.click(screen.getByRole('button', { name: /run scan/i }));
    await screen.findAllByTitle('Long-Term Analysis');

    await userEvent.click(screen.getAllByTitle('Long-Term Analysis')[0]);

    expect(screen.getByTestId('tab-panel-long-term-analysis')).not.toHaveClass('hidden');
    expect(within(screen.getByTestId('tab-panel-long-term-analysis')).getByLabelText('Ticker')).toHaveValue('AAA');
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/long-term/AAA');
  });

  test("a Contrarian Finder candidate row's CC button launches Contrarian Comeback and auto-runs Check Eligibility", async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      if (url === '/contrarian-finder/scan-batch') return mockScanBatch();
      if (url.endsWith('/gate')) return new Promise(() => {}); // left pending - only firing/handoff matters here
      return Promise.resolve({});
    });

    renderShell('/contrarian-finder');
    await userEvent.click(screen.getByRole('button', { name: /run scan/i }));
    await screen.findAllByTitle('Contrarian Comeback');

    await userEvent.click(screen.getAllByTitle('Contrarian Comeback')[0]);

    expect(screen.getByTestId('tab-panel-contrarian-comeback')).not.toHaveClass('hidden');
    expect(within(screen.getByTestId('tab-panel-contrarian-comeback')).getByLabelText('Ticker')).toHaveValue('AAA');
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/contrarian-comeback/AAA/gate');
  });
});
