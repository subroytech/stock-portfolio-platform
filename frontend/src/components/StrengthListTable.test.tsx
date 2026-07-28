import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StrengthListTable from './StrengthListTable';
import type { ScanResult } from '../api/contrarianFinder';

const result: ScanResult = {
  symbol: 'MSFT',
  filterFail: false,
  name: 'Microsoft Corporation',
  sector: 'Tech',
  price: 380,
  changePct: 2,
  strength: { rsi: 60, sma20: 370, sma50: 360, rr: 2.1, kF: 0.32, halfKelly: 0.16 },
};

describe('StrengthListTable', () => {
  test('shows an empty-state message when there are no strength candidates', () => {
    render(<StrengthListTable results={[]} />);
    expect(screen.getByText(/no strength-list candidates/i)).toBeInTheDocument();
  });

  test('renders both the mobile card layout and the desktop table, including SMA20/SMA50/Kelly %', () => {
    render(<StrengthListTable results={[result]} />);
    expect(screen.getAllByText('MSFT').length).toBe(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('$370.00').length).toBe(2); // SMA20
    expect(screen.getAllByText('$360.00').length).toBe(2); // SMA50
    expect(screen.getAllByText('32.0%').length).toBe(2); // Kelly % (kF)
    expect(screen.getAllByText('16.0%').length).toBe(2); // Half-Kelly
  });

  test('symbol click triggers the onSymbolClick callback', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    let clicked = '';
    render(<StrengthListTable results={[result]} onSymbolClick={(s) => { clicked = s; }} />);
    const buttons = screen.getAllByRole('button', { name: 'MSFT' });
    await userEvent.click(buttons[0]);
    expect(clicked).toBe('MSFT');
  });
});
