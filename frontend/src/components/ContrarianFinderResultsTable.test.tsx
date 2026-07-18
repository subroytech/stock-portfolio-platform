import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import ContrarianFinderResultsTable from './ContrarianFinderResultsTable';
import type { ScanResult } from '../api/contrarianFinder';

const result: ScanResult = {
  symbol: 'AAPL',
  filterFail: false,
  name: 'Apple Inc.',
  sector: 'Tech',
  price: 150,
  changePct: -30,
  strength: { rsi: 28, sma20: 145, sma50: 150, rr: 2.5, kF: 0.2, halfKelly: 0.1 },
};

describe('ContrarianFinderResultsTable', () => {
  test('shows an empty-state message when there are no candidates', () => {
    render(<ContrarianFinderResultsTable results={[]} />);
    expect(screen.getByText(/no candidates matched/i)).toBeInTheDocument();
  });

  test('renders both the mobile card layout and the desktop table for the same data', () => {
    render(<ContrarianFinderResultsTable results={[result]} />);
    expect(screen.getAllByText('AAPL').length).toBe(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
