import { useEffect, useState } from 'react';

// Backs the up-to-15-ticker sub-tab history on Long-Term Analysis and
// Contrarian Comeback - each page uses its own independent instance (own
// storageKey), generic over whatever payload shape that page caches per
// symbol. Persisted to sessionStorage the same way Contrarian Finder's scan
// results already are (see api/contrarianFinder.ts's LAST_SCAN_STORAGE_KEY) -
// session-only, survives a refresh, clears when the tab actually closes.

export interface TickerHistoryEntry<T> {
  symbol: string;
  data: T;
}

interface PersistedState<T> {
  entries: TickerHistoryEntry<T>[];
  activeSymbol: string | null;
}

interface UseTickerHistoryOptions {
  storageKey: string;
  maxEntries?: number;
}

function readPersisted<T>(storageKey: string): PersistedState<T> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { entries: [], activeSymbol: null };
    const parsed = JSON.parse(raw) as Partial<PersistedState<T>>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      activeSymbol: typeof parsed.activeSymbol === 'string' ? parsed.activeSymbol : null,
    };
  } catch {
    return { entries: [], activeSymbol: null }; // corrupt JSON, private-browsing quota, etc.
  }
}

function persist<T>(storageKey: string, state: PersistedState<T>): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // non-fatal - same as Contrarian Finder's own persistScanData
  }
}

export function useTickerHistory<T>({ storageKey, maxEntries = 15 }: UseTickerHistoryOptions) {
  const [entries, setEntries] = useState<TickerHistoryEntry<T>[]>(() => readPersisted<T>(storageKey).entries);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(() => readPersisted<T>(storageKey).activeSymbol);

  useEffect(() => {
    persist(storageKey, { entries, activeSymbol });
  }, [storageKey, entries, activeSymbol]);

  function has(symbol: string): boolean {
    return entries.some((e) => e.symbol === symbol);
  }

  // Case 2 - switch to an already-cached sub-tab, no reordering.
  function select(symbol: string): void {
    setActiveSymbol(symbol);
  }

  // Case 1 - a genuinely new symbol: unshift to the front, cap at
  // maxEntries (evicting the oldest), and switch to it.
  function insert(symbol: string, data: T): void {
    setEntries((prev) => [{ symbol, data }, ...prev.filter((e) => e.symbol !== symbol)].slice(0, maxEntries));
    setActiveSymbol(symbol);
  }

  // Updates an existing entry's payload in place, without reordering -
  // Contrarian Comeback needs this as its gate/checklist/submit workflow
  // progresses for the already-inserted active symbol.
  function update(symbol: string, data: T): void {
    setEntries((prev) => prev.map((e) => (e.symbol === symbol ? { symbol, data } : e)));
  }

  // Manual close (X icon) - removes that entry; filter() alone already
  // closes the gap (no empty slots at any position). If the closed tab was
  // active, falls back to whichever entry now sits in its old position (the
  // next tab shifted left), or the previous one if it was last, or none.
  function close(symbol: string): void {
    const idx = entries.findIndex((e) => e.symbol === symbol);
    if (idx === -1) return;
    const next = entries.filter((e) => e.symbol !== symbol);
    setEntries(next);
    if (activeSymbol === symbol) {
      const fallback = next[idx] ?? next[idx - 1];
      setActiveSymbol(fallback ? fallback.symbol : null);
    }
  }

  const active = activeSymbol ? entries.find((e) => e.symbol === activeSymbol)?.data ?? null : null;

  return { entries, activeSymbol, active, has, select, insert, update, close };
}
