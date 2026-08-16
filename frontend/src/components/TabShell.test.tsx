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
    // Long-Term Analysis/Contrarian Comeback's sub-tab history persists to
    // sessionStorage (see lib/tickerHistory.ts) - clear it so one test's
    // launched ticker can't leak into another as an already-cached sub-tab.
    sessionStorage.clear();
    // Dashboard's PortfolioSelector fires an unconditional /portfolios list
    // query the moment it mounts - every other tab only fetches on explicit
    // user action (useMutation), so a generic empty fallback covers the rest.
    // Default session: a regular (non-admin) user who HAS been granted
    // api_keys:manage_own - the realistic baseline for tests that aren't
    // specifically about permission gating, so the "API Keys" button they
    // rely on is actually present.
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['api_keys:manage_own'] });
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      return Promise.resolve({});
    });
  });

  test('renders all 5 tab links, the API Keys button, and Log out', async () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Long-Term Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contrarian Finder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contrarian Comeback' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Momentum Analysis' })).toBeInTheDocument();
    // API Keys only renders once the session (and canManageOwnKeys) has loaded.
    expect(await screen.findByRole('button', { name: 'API Keys' })).toBeInTheDocument();
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

  test('a non-admin session with api_keys:manage_own sees plain "API Keys", not an "Admin" link', async () => {
    renderShell();
    await screen.findByRole('button', { name: 'API Keys' });
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('a non-admin session WITHOUT api_keys:manage_own sees neither "API Keys" nor "Admin"', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: [] });
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      return Promise.resolve({});
    });
    renderShell();
    await screen.findByRole('button', { name: 'Log out' }); // wait for session to resolve
    expect(screen.queryByRole('button', { name: 'API Keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('an admin session sees an "Admin" link (to /admin) instead of a standalone API Keys button', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'admin@b.com', roles: ['admin'], permissions: ['api_keys:manage_own', 'users:manage_roles'] });
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      return Promise.resolve({});
    });
    renderShell();
    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('button', { name: 'API Keys' })).not.toBeInTheDocument();
  });

  test('a session with a differently-named role (e.g. admin-master) still sees "Admin" if it holds an admin-console permission', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'master@b.com', roles: ['admin-master'], permissions: ['api_keys:manage_own', 'functions:manage'] });
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      return Promise.resolve({});
    });
    renderShell();
    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('button', { name: 'API Keys' })).not.toBeInTheDocument();
  });

  test('API Keys button opens the modal, and Close dismisses it', async () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    // The button only renders once the session (and canManageOwnKeys) has loaded - findBy
    // waits for that, unlike getBy which would run before the async /auth/me fetch resolves.
    await userEvent.click(await screen.findByRole('button', { name: 'API Keys' }));
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
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['admin'], permissions: ['contrarian_finder:scan'] }); // scan-batch requires this permission
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      if (url === '/contrarian-finder/scan-batch') return mockScanBatch();
      if (url.startsWith('/analysis/long-term/')) return new Promise(() => {}); // left pending - only firing/handoff matters here
      return Promise.resolve({});
    });

    renderShell('/contrarian-finder');
    // The scan form only renders once the session (and its permissions) has loaded - findBy
    // waits for that, unlike getBy which would run before the async /auth/me fetch resolves.
    await userEvent.click(await screen.findByRole('button', { name: 'Run scan' }));
    await screen.findAllByTitle('Long-Term Analysis');

    await userEvent.click(screen.getAllByTitle('Long-Term Analysis')[0]);

    expect(screen.getByTestId('tab-panel-long-term-analysis')).not.toHaveClass('hidden');
    expect(within(screen.getByTestId('tab-panel-long-term-analysis')).getByLabelText('Ticker')).toHaveValue('AAA');
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/long-term/AAA');
  });

  describe('Portfolio tab - Legacy/Flex sub-tabs (Portfolio Upload - Flex, Phase 4)', () => {
    test('with both permissions, a Legacy/Flex nav appears and toggles between the two sub-panels', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['admin'], permissions: ['portfolio_upload:legacy', 'portfolio_upload:flex'] });
        if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
        return Promise.resolve({});
      });
      renderShell();

      expect(await screen.findByRole('button', { name: 'Legacy' })).toBeInTheDocument();
      expect(screen.getByTestId('portfolio-subtab-legacy')).not.toHaveClass('hidden');
      expect(screen.getByTestId('portfolio-subtab-flex')).toHaveClass('hidden');

      await userEvent.click(screen.getByRole('button', { name: 'Flex' }));
      expect(screen.getByTestId('portfolio-subtab-legacy')).toHaveClass('hidden');
      expect(screen.getByTestId('portfolio-subtab-flex')).not.toHaveClass('hidden');
    });

    test('a Flex-created portfolio never appears in the Legacy sub-tab\'s selector', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['admin'], permissions: ['portfolio_upload:legacy', 'portfolio_upload:flex'] });
        if (url === '/portfolios') {
          return Promise.resolve({
            portfolios: [
              { id: '1', name: 'Legacy Portfolio', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: null },
              { id: '2', name: 'Flex Portfolio', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: 't1', flexTemplateStatus: 'Flex' },
            ],
          });
        }
        if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
        if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
        return Promise.resolve({});
      });
      renderShell();

      await screen.findByRole('button', { name: 'Legacy Portfolio' });
      const legacyPanel = screen.getByTestId('portfolio-subtab-legacy');
      expect(within(legacyPanel).queryByRole('button', { name: 'Flex Portfolio' })).not.toBeInTheDocument();
      // Sanity check it does exist, just on the Flex sub-panel instead.
      expect(within(screen.getByTestId('portfolio-subtab-flex')).getByTestId('flex-portfolio-pill-2')).toHaveTextContent('Flex Portfolio');
    });

    test('with only portfolio_upload:legacy, no nav renders and only the Legacy sub-panel is mounted', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['portfolio_upload:legacy'] });
        if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
        return Promise.resolve({});
      });
      renderShell();

      await screen.findByTestId('portfolio-subtab-legacy');
      expect(screen.queryByRole('button', { name: 'Legacy' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('portfolio-subtab-flex')).not.toBeInTheDocument();
    });

    test('with only portfolio_upload:flex, no nav renders and only the Flex sub-panel is mounted', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['portfolio_upload:flex'] });
        if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
        if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
        if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
        return Promise.resolve({});
      });
      renderShell();

      await screen.findByTestId('portfolio-subtab-flex');
      expect(screen.queryByRole('button', { name: 'Legacy' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('portfolio-subtab-legacy')).not.toBeInTheDocument();
    });

    test('with neither permission, falls back to a read-only Legacy view (no upload control)', async () => {
      vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['user'], permissions: [] });
        if (url === '/portfolios') return Promise.resolve({ portfolios: [{ id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: null }] });
        if (url === '/portfolios/1') {
          return Promise.resolve({
            portfolio: {
              id: '1', name: 'Fidelity', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: null,
              cashAmount: 0, totalHoldingsValue: 0, totalCostBasis: 0, totalGainLoss: 0, totalPortfolioValue: 0, holdings: [],
            },
          });
        }
        return Promise.resolve({});
      });
      renderShell();

      await screen.findByTestId('portfolio-subtab-legacy');
      expect(screen.queryByTestId('portfolio-subtab-flex')).not.toBeInTheDocument();

      await userEvent.click(await screen.findByRole('button', { name: 'Fidelity' }));
      await screen.findByText('Holdings');
      expect(screen.queryByTestId('import-file-input')).not.toBeInTheDocument();
    });
  });

  test("a Contrarian Finder candidate row's CC button launches Contrarian Comeback and auto-runs Check Eligibility", async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve({ id: '1', email: 'a@b.com', roles: ['admin'], permissions: ['contrarian_finder:scan'] }); // scan-batch requires this permission
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/subscriptions') return Promise.resolve({ subscriptions: [] });
      if (url === '/contrarian-finder/scan-batch') return mockScanBatch();
      if (url.endsWith('/gate')) return new Promise(() => {}); // left pending - only firing/handoff matters here
      return Promise.resolve({});
    });

    renderShell('/contrarian-finder');
    // The scan form only renders once the session (and its permissions) has loaded - findBy
    // waits for that, unlike getBy which would run before the async /auth/me fetch resolves.
    await userEvent.click(await screen.findByRole('button', { name: 'Run scan' }));
    await screen.findAllByTitle('Contrarian Comeback');

    await userEvent.click(screen.getAllByTitle('Contrarian Comeback')[0]);

    expect(screen.getByTestId('tab-panel-contrarian-comeback')).not.toHaveClass('hidden');
    expect(within(screen.getByTestId('tab-panel-contrarian-comeback')).getByLabelText('Ticker')).toHaveValue('AAA');
    expect(client.apiFetch).toHaveBeenCalledWith('/analysis/contrarian-comeback/AAA/gate');
  });
});
