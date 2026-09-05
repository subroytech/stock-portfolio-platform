import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import FlexPortfolioPage from './FlexPortfolioPage';
import type { PortfolioDetail, PortfolioSummary } from '../api/portfolios';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FlexPortfolioPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function summary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return { id: '1', name: 'Legacy One', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: null, ...overrides };
}

function detail(overrides: Partial<PortfolioDetail> = {}): PortfolioDetail {
  return {
    id: '1', name: 'Flex One', broker: null, createdAt: 't1', updatedAt: 't1', uploadTemplateId: null, flexTemplateStatus: 'Flex-Err',
    cashAmount: 0, totalHoldingsValue: 1500, totalCostBasis: 1500, totalGainLoss: 0, totalPortfolioValue: 1500,
    holdings: [{
      id: 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, purchasePrice: 150, currentPrice: 150,
      sector: 'Technology', purchaseDate: null, costBasis: 1500, currentValue: 1500, gainLoss: 0, returnPct: 0,
      allocationPct: 100, priceUpdatedAt: null, todayChangeDollar: null, todayChangePercent: null,
    }],
    ...overrides,
  };
}

function csvFile(content: string, name = 'holdings.csv') {
  return new File([content], name, { type: 'text/csv' });
}

// jsdom doesn't implement IntersectionObserver - ColumnMappingWizard's "scroll to review" gate
// on Use This Mapping needs one. Captures every observer's callback so a test can simulate its
// sentinel scrolling into view on demand, without a real scroll.
let intersectionCallbacks: IntersectionObserverCallback[] = [];
function simulatePreviewScrolledIntoView() {
  act(() => {
    intersectionCallbacks.forEach((cb) => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  });
}

describe('FlexPortfolioPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal('IntersectionObserver', vi.fn(function (this: unknown, cb: IntersectionObserverCallback) {
      intersectionCallbacks.push(cb);
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(), takeRecords: vi.fn(() => []), root: null, rootMargin: '', thresholds: [] };
    }));
  });

  test('only lists portfolios with a non-null flexTemplateStatus', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') {
        return Promise.resolve({
          portfolios: [
            summary({ id: '1', name: 'Legacy One', flexTemplateStatus: null }),
            summary({ id: '2', name: 'Flex Resolved', flexTemplateStatus: 'Flex', uploadTemplateId: 't1' }),
          ],
        });
      }
      return Promise.resolve({});
    });
    renderPage();

    expect(await screen.findByTestId('flex-portfolio-pill-2')).toBeInTheDocument();
    expect(screen.queryByTestId('flex-portfolio-pill-1')).not.toBeInTheDocument();
  });

  test('a Flex-Err portfolio shows a warning marker on its pill and the resolution banner once selected', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [summary({ id: '2', name: 'Needs Fix', flexTemplateStatus: 'Flex-Err' })] });
      if (url === '/portfolios/2') return Promise.resolve({ portfolio: detail({ id: '2', name: 'Needs Fix' }) });
      return Promise.resolve({});
    });
    renderPage();

    const pill = await screen.findByTestId('flex-portfolio-pill-2');
    expect(pill.textContent).toMatch(/⚠/);

    await userEvent.click(pill);
    expect(await screen.findByText(/this portfolio needs attention/i)).toBeInTheDocument();
  });

  test('clicking "+ New Flex Portfolio" clears the currently selected portfolio\'s Dashboard, not just opens the wizard on top of it', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [summary({ id: '2', name: 'Existing Flex', flexTemplateStatus: 'Flex', uploadTemplateId: 't1' })] });
      if (url === '/portfolios/2') return Promise.resolve({ portfolio: detail({ id: '2', name: 'Existing Flex', flexTemplateStatus: 'Flex', uploadTemplateId: 't1' }) });
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('flex-portfolio-pill-2'));
    expect(await screen.findByText('Holdings')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('flex-new-portfolio-button'));

    expect(screen.getByText('Create New Portfolio — Flex')).toBeInTheDocument();
    expect(screen.queryByText('Holdings')).not.toBeInTheDocument();
  });

  test('creating a new Flex portfolio from an existing template skips the mapping wizard entirely', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [{ id: 't1', templateName: 'Schwab Export', status: 'Approved', createdBy: 'u1', createdAt: 't1' }] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      if (url === '/portfolios/flex' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        expect(body).toMatchObject({ name: 'New Flex Portfolio', uploadTemplateId: 't1', filename: 'holdings.csv' });
        return Promise.resolve({
          portfolio: { id: '9', name: 'New Flex Portfolio', broker: null, uploadTemplateId: 't1', flexTemplateStatus: 'Flex' },
          importResult: { holdingsCount: 1, cashAmount: 0, actionsLogged: 1, uploadId: 'u1' },
        });
      }
      if (url === '/portfolios/9') return Promise.resolve({ portfolio: detail({ id: '9', name: 'New Flex Portfolio', flexTemplateStatus: 'Flex', uploadTemplateId: 't1' }) });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('flex-new-portfolio-button'));
    await userEvent.click(await screen.findByTestId('flex-template-option-t1'));

    // Mapping wizard never shown for an existing-template path.
    expect(screen.queryByTestId('flex-mapping-file-input')).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId('flex-portfolio-name-input'), 'New Flex Portfolio');
    await userEvent.upload(screen.getByTestId('flex-existing-template-file-input'), csvFile('Ticker,Shares,Price\nAAPL,10,150'));

    const submit = screen.getByTestId('flex-create-portfolio-submit');
    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);

    expect(await screen.findByText('Holdings')).toBeInTheDocument();
  });

  test('creating with a brand-new mapping goes through Inspect Data before Create Portfolio is offered', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/portfolios') return Promise.resolve({ portfolios: [] });
      if (url === '/portfolio-templates') return Promise.resolve({ templates: [] });
      if (url === '/portfolio-templates/mine/pending') return Promise.resolve({ templates: [] });
      if (url === '/portfolios/flex' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        if (body.dryRun) {
          return Promise.resolve({
            preview: true,
            holdings: [{ symbol: 'AAPL', name: '', quantity: 10, purchasePrice: 150, currentPrice: 150, sector: '', purchaseDate: '', costBasis: 1500, currentValue: 1500, gainLoss: 0, returnPct: 0 }],
            cashAmount: 0,
            errors: [],
          });
        }
        expect(body).toMatchObject({ name: 'Brand New Mapping', columnMapping: { symbol: 'Ticker', quantity: 'Shares', currentPrice: 'Price' } });
        expect(body.footerMarkerColumnIndex).toBeUndefined(); // no footer marker set in the wizard - threads through as undefined, not a crash
        expect(body.footerMarkerText).toBeUndefined();
        return Promise.resolve({
          portfolio: { id: '9', name: 'Brand New Mapping', broker: null, uploadTemplateId: null, flexTemplateStatus: 'Flex-Err' },
          importResult: { holdingsCount: 1, cashAmount: 0, actionsLogged: 1, uploadId: 'u1' },
        });
      }
      if (url === '/portfolios/9') return Promise.resolve({ portfolio: detail({ id: '9', name: 'Brand New Mapping' }) });
      return Promise.resolve({});
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('flex-new-portfolio-button'));
    await userEvent.click(await screen.findByTestId('flex-create-new-template'));

    await userEvent.upload(screen.getByTestId('flex-mapping-file-input'), csvFile('Ticker,Shares,Price\nAAPL,10,150'));
    // The wizard's guided Header -> Footer -> Cash -> Map Columns stepper - confirm the
    // (default) header row, then skip the two optional stages to reach mapping.
    await userEvent.click(await screen.findByTestId('grid-cell-0-0'));
    await userEvent.click(screen.getByTestId('wizard-next-header'));
    await userEvent.click(screen.getByTestId('wizard-next-footer'));
    await userEvent.click(screen.getByTestId('wizard-next-cash'));
    await userEvent.selectOptions(await screen.findByTestId('flex-map-symbol'), 'Ticker');
    await userEvent.selectOptions(screen.getByTestId('flex-map-quantity'), 'Shares');
    await userEvent.selectOptions(screen.getByTestId('flex-map-currentPrice'), 'Price');
    await userEvent.click(screen.getByTestId('flex-inspect-data'));
    await screen.findByTestId('flex-use-mapping');
    simulatePreviewScrolledIntoView();
    await userEvent.click(screen.getByTestId('flex-use-mapping'));

    // Now on the finalize step - no second file prompt, the wizard's already-inspected content is reused.
    expect(screen.queryByTestId('flex-existing-template-file-input')).not.toBeInTheDocument();
    await userEvent.type(screen.getByTestId('flex-portfolio-name-input'), 'Brand New Mapping');
    await userEvent.click(screen.getByTestId('flex-create-portfolio-submit'));

    expect(await screen.findByText(/this portfolio needs attention/i)).toBeInTheDocument();
  });
});
