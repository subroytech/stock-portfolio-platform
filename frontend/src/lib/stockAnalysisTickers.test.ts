import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { useStockAnalysisTickers, QUADRANT_COUNT } from './stockAnalysisTickers';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useStockAnalysisTickers', () => {
  test('starts with 4 empty slots', () => {
    const { result } = renderHook(() => useStockAnalysisTickers());
    expect(result.current.slots).toEqual(Array(QUADRANT_COUNT).fill(null));
  });

  test('setSlot sets only the targeted slot, leaving the others untouched', () => {
    const { result } = renderHook(() => useStockAnalysisTickers());
    act(() => result.current.setSlot(1, 'AAPL'));
    expect(result.current.slots).toEqual([null, 'AAPL', null, null]);

    act(() => result.current.setSlot(3, 'TSLA'));
    expect(result.current.slots).toEqual([null, 'AAPL', null, 'TSLA']);
  });

  test('clearSlot empties only the targeted slot', () => {
    const { result } = renderHook(() => useStockAnalysisTickers());
    act(() => {
      result.current.setSlot(0, 'AAPL');
      result.current.setSlot(1, 'MSFT');
    });
    act(() => result.current.clearSlot(0));
    expect(result.current.slots).toEqual([null, 'MSFT', null, null]);
  });

  test('persists across remounts (sessionStorage round-trip)', () => {
    const first = renderHook(() => useStockAnalysisTickers());
    act(() => first.result.current.setSlot(2, 'NVDA'));
    first.unmount();

    const second = renderHook(() => useStockAnalysisTickers());
    expect(second.result.current.slots).toEqual([null, null, 'NVDA', null]);
  });

  test('recovers to 4 empty slots from corrupt sessionStorage JSON', () => {
    sessionStorage.setItem('stockAnalysis:tickers', '{not valid json');
    const { result } = renderHook(() => useStockAnalysisTickers());
    expect(result.current.slots).toEqual(Array(QUADRANT_COUNT).fill(null));
  });
});
