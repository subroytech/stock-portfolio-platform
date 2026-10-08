import { useEffect, useState } from 'react';

// Stock Analysis tab - 4 independent, simultaneous quadrants. Deliberately not built on
// tickerHistory.ts's useTickerHistory(): that hook models "one active symbol + a switchable
// history list," which is the wrong shape here - all 4 slots are always visible at once, not
// one-active-of-many. Persisted to sessionStorage the same way Contrarian Finder's scan results
// and Long-Term Analysis/Contrarian Comeback's ticker history already are - session-only,
// survives a reload, clears when the tab actually closes.

const STORAGE_KEY = 'stockAnalysis:tickers';
export const QUADRANT_COUNT = 4;

type Slots = (string | null)[];

function emptySlots(): Slots {
  return Array(QUADRANT_COUNT).fill(null);
}

function readPersisted(): Slots {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySlots();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return emptySlots();
    const slots = emptySlots();
    for (let i = 0; i < QUADRANT_COUNT; i++) {
      if (typeof parsed[i] === 'string') slots[i] = parsed[i];
    }
    return slots;
  } catch {
    return emptySlots(); // corrupt JSON, private-browsing quota, etc.
  }
}

function persist(slots: Slots): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // non-fatal - same as Contrarian Finder's own persistScanData
  }
}

export function useStockAnalysisTickers() {
  const [slots, setSlots] = useState<Slots>(readPersisted);

  useEffect(() => {
    persist(slots);
  }, [slots]);

  function setSlot(index: number, symbol: string): void {
    setSlots((prev) => prev.map((s, i) => (i === index ? symbol : s)));
  }

  function clearSlot(index: number): void {
    setSlots((prev) => prev.map((s, i) => (i === index ? null : s)));
  }

  return { slots, setSlot, clearSlot };
}
