// Short-lived Gate -> Submit cache for Contrarian Comeback (2026-09-06). fetchContrarianComebackData()
// is called independently and statelessly by both contrarianComebackGate() and
// contrarianComebackSubmit() - real-world usage showed this costing the full ~10 FMP + 1 Finnhub
// calls TWICE for what a user experiences as one analysis. Gate populates this cache; Submit
// reuses it if still fresh, cutting that in half on the common path.
//
// In-memory, not DB-backed - the simplest option, and a miss (expired, never gated, or the
// process restarted) just falls back to today's fresh-fetch behavior, never a correctness bug.
// Keyed by (userId, symbol), not symbol alone - matches "this user's own gate-then-submit round
// trip," not cross-user sharing. 30-minute TTL - accepted knowingly for this feature's
// retail-investor pace, not a high-speed-trading use case.
//
// No setInterval/background timer - cleanup happens opportunistically on every write, keeping
// this dependency-free and free of Jest open-handle/fake-timer complications.

import type { ContrarianComebackData } from './contrarianComebackData.service';

const TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  data: ContrarianComebackData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, symbol: string): string {
  return `${userId}:${symbol}`;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}

export function setCachedGateResult(userId: string, symbol: string, data: ContrarianComebackData): void {
  cache.set(cacheKey(userId, symbol), { data, expiresAt: Date.now() + TTL_MS });
  sweepExpired();
}

export function getCachedGateResult(userId: string, symbol: string): ContrarianComebackData | null {
  const key = cacheKey(userId, symbol);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// Test-only reset hook - this module's Map is process-lifetime singleton state, so tests that
// reuse the same (userId, symbol) across cases need an explicit way to start clean.
export function clearAll(): void {
  cache.clear();
}
