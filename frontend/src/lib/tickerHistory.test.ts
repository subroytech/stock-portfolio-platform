import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { useTickerHistory } from './tickerHistory';

const KEY = 'test:tickerHistory';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useTickerHistory', () => {
  test('insert adds a new entry at position 1 and makes it active', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => result.current.insert('AAPL', { v: 1 }));
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['AAPL']);
    expect(result.current.activeSymbol).toBe('AAPL');
    expect(result.current.active).toEqual({ v: 1 });

    act(() => result.current.insert('MSFT', { v: 2 }));
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['MSFT', 'AAPL']);
    expect(result.current.activeSymbol).toBe('MSFT');
  });

  test('inserting a 16th new symbol evicts the oldest (position 15)', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => {
      for (let i = 1; i <= 15; i++) result.current.insert(`SYM${i}`, { v: i });
    });
    expect(result.current.entries).toHaveLength(15);
    expect(result.current.entries.map((e) => e.symbol)[14]).toBe('SYM1'); // oldest, still position 15

    act(() => result.current.insert('SYM16', { v: 16 }));
    expect(result.current.entries).toHaveLength(15);
    expect(result.current.entries.map((e) => e.symbol)).not.toContain('SYM1'); // evicted
    expect(result.current.entries[0].symbol).toBe('SYM16');
  });

  test('select (Case 2) switches the active tab without reordering', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => {
      result.current.insert('AAPL', { v: 1 });
      result.current.insert('MSFT', { v: 2 });
      result.current.insert('TSLA', { v: 3 });
    });
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['TSLA', 'MSFT', 'AAPL']);

    act(() => result.current.select('AAPL'));
    expect(result.current.activeSymbol).toBe('AAPL');
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['TSLA', 'MSFT', 'AAPL']); // unchanged order
  });

  test('has() reflects current membership', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    expect(result.current.has('AAPL')).toBe(false);
    act(() => result.current.insert('AAPL', { v: 1 }));
    expect(result.current.has('AAPL')).toBe(true);
  });

  test('update() rewrites an entry in place without reordering', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => {
      result.current.insert('AAPL', { v: 1 });
      result.current.insert('MSFT', { v: 2 });
    });
    act(() => result.current.update('AAPL', { v: 99 }));
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['MSFT', 'AAPL']); // order unchanged
    expect(result.current.entries.find((e) => e.symbol === 'AAPL')?.data).toEqual({ v: 99 });
  });

  test('close() removes an entry with no gap left behind, and falls back the active tab if it was closed', () => {
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => {
      result.current.insert('AAPL', { v: 1 });
      result.current.insert('MSFT', { v: 2 });
      result.current.insert('TSLA', { v: 3 }); // order: TSLA, MSFT, AAPL - active: TSLA
    });

    act(() => result.current.close('MSFT')); // close a middle tab, not the active one
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['TSLA', 'AAPL']); // no gap
    expect(result.current.activeSymbol).toBe('TSLA'); // untouched, wasn't the closed tab

    act(() => result.current.close('TSLA')); // close the active tab
    expect(result.current.entries.map((e) => e.symbol)).toEqual(['AAPL']);
    expect(result.current.activeSymbol).toBe('AAPL'); // falls back to what's now in that position

    act(() => result.current.close('AAPL')); // close the last remaining (and active) tab
    expect(result.current.entries).toEqual([]);
    expect(result.current.activeSymbol).toBeNull();
  });

  test('persists across a remount (sessionStorage round-trip)', () => {
    const first = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    act(() => first.result.current.insert('AAPL', { v: 1 }));
    first.unmount();

    const second = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    expect(second.result.current.entries).toEqual([{ symbol: 'AAPL', data: { v: 1 } }]);
    expect(second.result.current.activeSymbol).toBe('AAPL');
  });

  test('does not crash on corrupt sessionStorage content', () => {
    sessionStorage.setItem(KEY, '{not valid json');
    const { result } = renderHook(() => useTickerHistory<{ v: number }>({ storageKey: KEY }));
    expect(result.current.entries).toEqual([]);
    expect(result.current.activeSymbol).toBeNull();
  });
});
