import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import { STRENGTH_LIST_QUERY_KEY, type ScanResult } from '../api/contrarianFinder';
import MomentumPage from './MomentumPage';

function renderPage(seedStrengthList?: ScanResult[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedStrengthList) {
    queryClient.setQueryData(STRENGTH_LIST_QUERY_KEY, seedStrengthList);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MomentumPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MomentumPage — Strength List cross-read', () => {
  test('renders nothing when no Contrarian Finder scan has populated the cache yet', () => {
    renderPage();
    expect(screen.queryByText(/Strength List/i)).not.toBeInTheDocument();
  });

  test('renders the Strength List table when the shared cache has entries', () => {
    renderPage([
      { symbol: 'NVDA', filterFail: false, name: 'NVIDIA Corporation', sector: 'Technology', price: 200, strength: { rsi: 61, sma20: 190, sma50: 180, rr: 2.2, kF: 0.4, halfKelly: 0.2 } },
    ]);
    expect(screen.getByText(/Strength List \(from last Contrarian Finder scan\)/i)).toBeInTheDocument();
    expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0);
  });
});
