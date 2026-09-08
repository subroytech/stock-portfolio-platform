import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as client from '../api/client';
import StockAnalysisPage from './StockAnalysisPage';

vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="chart-stub-line" />,
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StockAnalysisPage />
    </QueryClientProvider>,
  );
}

describe('StockAnalysisPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    vi.spyOn(client, 'apiFetch').mockImplementation((url: string) => {
      const symbol = url.replace('/stock-preview/', '');
      return Promise.resolve({
        symbol,
        quote: { price: 100, changeDollar: 1, changePercent: 1, name: `${symbol} Inc.`, isActivelyTrading: false },
        historical: [],
      });
    });
  });

  test('renders 4 independent quadrants', () => {
    renderPage();
    expect(screen.getAllByTestId('stock-analysis-quadrant-input')).toHaveLength(4);
  });

  test('setting a ticker in one quadrant does not affect the others', async () => {
    renderPage();
    const inputs = screen.getAllByTestId('stock-analysis-quadrant-input');
    await userEvent.type(inputs[0], 'aapl');
    await userEvent.click(screen.getAllByTestId('stock-analysis-quadrant-go')[0]);

    expect(await screen.findByText(/AAPL Inc\./)).toBeInTheDocument();
    // The other 3 quadrants are still empty inputs.
    expect(screen.getAllByTestId('stock-analysis-quadrant-input')).toHaveLength(3);
  });

  test('a set ticker survives a remount (sessionStorage persistence)', async () => {
    const { unmount } = renderPage();
    const inputs = screen.getAllByTestId('stock-analysis-quadrant-input');
    await userEvent.type(inputs[2], 'tsla');
    await userEvent.click(screen.getAllByTestId('stock-analysis-quadrant-go')[2]);
    await screen.findByText(/TSLA Inc\./);
    unmount();

    renderPage();
    expect(await screen.findByText(/TSLA Inc\./)).toBeInTheDocument();
    expect(screen.getAllByTestId('stock-analysis-quadrant-input')).toHaveLength(3);
  });

  test('clearing a quadrant only resets that one', async () => {
    renderPage();
    const inputs = screen.getAllByTestId('stock-analysis-quadrant-input');
    await userEvent.type(inputs[0], 'aapl');
    await userEvent.click(screen.getAllByTestId('stock-analysis-quadrant-go')[0]);
    await screen.findByText(/AAPL Inc\./);

    await userEvent.click(screen.getByTestId('stock-analysis-quadrant-clear'));
    expect(screen.getAllByTestId('stock-analysis-quadrant-input')).toHaveLength(4);
  });
});
