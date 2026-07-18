import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import ImportPreviewPage from './ImportPreviewPage';
import type { ImportPreviewResult } from '../api/portfolios';

function renderAt(path: string, state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path="/" element={<div>Dashboard</div>} />
          <Route path="/portfolios/:id/import-preview" element={<ImportPreviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const preview: ImportPreviewResult = {
  preview: true,
  sourceFormat: 'csv',
  cashAmount: 500,
  errors: ['Row 3: Invalid quantity (XYZ)'],
  holdings: [{
    symbol: 'AAPL', name: 'Apple Inc.', quantity: 10, purchasePrice: 100, currentPrice: 150,
    sector: 'Technology', purchaseDate: '', costBasis: 1000, currentValue: 1500, gainLoss: 500, returnPct: 50,
  }],
};

describe('ImportPreviewPage', () => {
  test('redirects to the dashboard when there is no navigation state', () => {
    renderAt('/portfolios/1/import-preview');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  test('shows the unsaved banner, holdings, cash amount, and parse errors when state is present', () => {
    renderAt('/portfolios/1/import-preview', { filename: 'test.csv', content: 'Symbol,Quantity,Current Price\nAAPL,10,150', preview });
    expect(screen.getByText(/Unsaved — this file has not been imported/)).toBeInTheDocument();
    expect(screen.getByText('test.csv')).toBeInTheDocument();
    expect(screen.getByText(/1 holdings parsed/)).toBeInTheDocument();
    expect(screen.getByText(/Cash: \$500/)).toBeInTheDocument();
    expect(screen.getByText('Row 3: Invalid quantity (XYZ)')).toBeInTheDocument();
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
  });
});
