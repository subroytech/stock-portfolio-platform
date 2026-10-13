import { describe, expect, test } from 'vitest';
import { parseCsvHeaderRow, parseCsvGrid } from './csvHeaders';

describe('parseCsvHeaderRow', () => {
  test('splits a simple header row', () => {
    expect(parseCsvHeaderRow('Ticker,Shares,Price\nAAPL,10,150')).toEqual(['Ticker', 'Shares', 'Price']);
  });

  test('handles quoted cells with embedded commas', () => {
    expect(parseCsvHeaderRow('"Symbol, Ticker",Shares')).toEqual(['Symbol, Ticker', 'Shares']);
  });

  test('handles escaped double-quotes inside a quoted cell', () => {
    expect(parseCsvHeaderRow('"Say ""Hi""",Shares')).toEqual(['Say "Hi"', 'Shares']);
  });

  test('filters out empty cells', () => {
    expect(parseCsvHeaderRow('Ticker,,Price')).toEqual(['Ticker', 'Price']);
  });
});

describe('parseCsvGrid', () => {
  test('returns one row per line, each split into cells', () => {
    expect(parseCsvGrid('Ticker,Shares,Price\nAAPL,10,150')).toEqual([
      ['Ticker', 'Shares', 'Price'],
      ['AAPL', '10', '150'],
    ]);
  });

  test('does NOT filter empty cells - cell positions must line up with real column numbers', () => {
    expect(parseCsvGrid('Ticker,,Price')).toEqual([['Ticker', '', 'Price']]);
  });

  test('preserves ragged row lengths (no padding)', () => {
    expect(parseCsvGrid('A\nB,C,D')).toEqual([['A'], ['B', 'C', 'D']]);
  });

  test('caps the number of returned rows at maxRows', () => {
    const content = ['a', 'b', 'c', 'd', 'e'].join('\n');
    expect(parseCsvGrid(content, 3)).toEqual([['a'], ['b'], ['c']]);
  });

  test('handles quoted cells with embedded commas, same as parseCsvHeaderRow', () => {
    expect(parseCsvGrid('"Account, Summary"\nTicker,Shares')).toEqual([
      ['Account, Summary'],
      ['Ticker', 'Shares'],
    ]);
  });
});
