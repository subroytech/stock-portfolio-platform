import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import ContrarianFinderResultsTable from './ContrarianFinderResultsTable';
import type { ScanResult } from '../api/contrarianFinder';

const result: ScanResult = {
  symbol: 'AAPL',
  filterFail: false,
  name: 'Apple Inc.',
  sector: 'Tech',
  price: 150,
  mktCap: 3_000_000_000_000,
  volume: 2_000_000,
  avgVol: 800_000,
  changePct: -30,
  mktClosed: false,
  source: 'DJ30',
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

  test('renders market cap, volume/avg ratio, source index, and open/closed badge', () => {
    render(<ContrarianFinderResultsTable results={[result]} />);
    expect(screen.getAllByText('$3T').length).toBe(2); // mobile + desktop
    expect(screen.getAllByText('2.5×').length).toBe(2); // 2,000,000 / 800,000
    expect(screen.getAllByText('DJ30').length).toBe(2);
    expect(screen.getAllByText('Open').length).toBe(2);
  });

  test('applies the most severe decline styling at -30% (>= -25% tier)', () => {
    render(<ContrarianFinderResultsTable results={[result]} />);
    const changeCells = screen.getAllByText('-30.00%');
    expect(changeCells[0].className).toMatch(/text-danger/);
    expect(changeCells[0].className).toMatch(/font-bold/);
  });

  test('shows "Closed" badge and no volume highlight when volume is below 2x average', () => {
    const closedLowVol: ScanResult = { ...result, mktClosed: true, volume: 900_000, avgVol: 800_000 };
    render(<ContrarianFinderResultsTable results={[closedLowVol]} />);
    expect(screen.getAllByText('Closed').length).toBe(2);
    expect(screen.getAllByText('1.1×')[0].className).not.toMatch(/text-warning/);
  });

  test('LT/CC launch buttons only render when their handler prop is passed', () => {
    render(<ContrarianFinderResultsTable results={[result]} />);
    expect(screen.queryByTitle('Long-Term Analysis')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Contrarian Comeback')).not.toBeInTheDocument();
  });

  test('LT button fires onLongTermAnalysis with the row symbol', async () => {
    const onLongTermAnalysis = vi.fn();
    render(<ContrarianFinderResultsTable results={[result]} onLongTermAnalysis={onLongTermAnalysis} />);
    await userEvent.click(screen.getAllByTitle('Long-Term Analysis')[0]);
    expect(onLongTermAnalysis).toHaveBeenCalledWith('AAPL');
  });

  test('CC button fires onContrarianComeback with the row symbol', async () => {
    const onContrarianComeback = vi.fn();
    render(<ContrarianFinderResultsTable results={[result]} onContrarianComeback={onContrarianComeback} />);
    await userEvent.click(screen.getAllByTitle('Contrarian Comeback')[0]);
    expect(onContrarianComeback).toHaveBeenCalledWith('AAPL');
  });
});
