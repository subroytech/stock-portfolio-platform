import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import StockAnalysisQuadrant from './StockAnalysisQuadrant';
import { TickerHandoffContext } from '../lib/tickerHandoff';
import type { HistoricalBar } from '../lib/stockPreview';

// StockPreviewBody's chart isn't what this file is testing (StockPreviewBody covers its own
// rendering via lib/stockPreview.test.ts's pure math) - stubbing it avoids the jsdom/chart.js
// canvas incompatibilities other test files in this repo have already hit.
vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="chart-stub-line" />,
}));

function historicalBars(count: number): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date('2026-01-01T00:00:00Z');
    d.setDate(d.getDate() - i);
    bars.push({ date: d.toISOString().slice(0, 10), close: 100 + i });
  }
  return bars;
}

function renderQuadrant(props: Partial<{ symbol: string | null; onSet: (s: string) => void; onClear: () => void }> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSet = props.onSet ?? vi.fn();
  const onClear = props.onClear ?? vi.fn();
  const launch = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TickerHandoffContext.Provider value={{ handoff: null, launch }}>
        <StockAnalysisQuadrant symbol={props.symbol ?? null} onSet={onSet} onClear={onClear} />
      </TickerHandoffContext.Provider>
    </QueryClientProvider>,
  );
  return { onSet, onClear, launch };
}

describe('StockAnalysisQuadrant', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('empty quadrant shows a ticker input with Go disabled until something is typed', async () => {
    renderQuadrant();
    expect(screen.getByTestId('stock-analysis-quadrant-input')).toBeInTheDocument();
    expect(screen.getByTestId('stock-analysis-quadrant-go')).toBeDisabled();

    await userEvent.type(screen.getByTestId('stock-analysis-quadrant-input'), 'aapl');
    expect(screen.getByTestId('stock-analysis-quadrant-go')).not.toBeDisabled();
  });

  test('submitting a ticker calls onSet with the uppercased symbol', async () => {
    const { onSet } = renderQuadrant();
    await userEvent.type(screen.getByTestId('stock-analysis-quadrant-input'), 'aapl');
    await userEvent.click(screen.getByTestId('stock-analysis-quadrant-go'));
    expect(onSet).toHaveBeenCalledWith('AAPL');
  });

  test('with a symbol set, renders the preview body and a Clear control instead of the input', async () => {
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      if (url === '/stock-preview/AAPL') {
        return Promise.resolve({
          symbol: 'AAPL',
          quote: { price: 150, changeDollar: 1, changePercent: 0.7, name: 'Apple Inc.', isActivelyTrading: false },
          historical: historicalBars(30),
        });
      }
      return Promise.resolve({});
    });
    renderQuadrant({ symbol: 'AAPL' });

    expect(screen.queryByTestId('stock-analysis-quadrant-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('stock-analysis-quadrant-clear')).toBeInTheDocument();
    expect(await screen.findByText(/Apple Inc\./)).toBeInTheDocument();
    expect(screen.getByTestId('chart-stub-line')).toBeInTheDocument();
  });

  test('Clear calls onClear', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ symbol: 'AAPL', quote: null, historical: [] });
    const { onClear } = renderQuadrant({ symbol: 'AAPL' });

    await userEvent.click(screen.getByTestId('stock-analysis-quadrant-clear'));
    expect(onClear).toHaveBeenCalled();
  });

  test('LT launches Long-Term Analysis and CC launches Contrarian Comeback for the quadrant\'s own symbol', async () => {
    vi.spyOn(client, 'apiFetch').mockResolvedValue({ symbol: 'AAPL', quote: null, historical: [] });
    const { launch } = renderQuadrant({ symbol: 'AAPL' });

    await userEvent.click(screen.getByTestId('stock-analysis-quadrant-lt'));
    expect(launch).toHaveBeenCalledWith('long-term-analysis', 'AAPL');

    await userEvent.click(screen.getByTestId('stock-analysis-quadrant-cc'));
    expect(launch).toHaveBeenCalledWith('contrarian-comeback', 'AAPL');
  });
});
