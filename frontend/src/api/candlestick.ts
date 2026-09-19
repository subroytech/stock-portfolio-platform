import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';

// Stock Analysis - Candlestick Charts (Phase 1). 1min was considered and dropped - live-verified
// against a real FMP account as a genuine plan-tier restriction (HTTP 402), not a market-hours
// artifact - see candlestick.service.ts's migration/header comments on the backend.
export type CandlestickInterval = '5min' | '15min' | '30min' | '1hour' | '4hour' | '1day';
export const CANDLESTICK_INTERVALS: CandlestickInterval[] = ['5min', '15min', '30min', '1hour', '4hour', '1day'];

export interface CandlestickBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MacdIndicator {
  macd: number;
  signal: number;
  hist: number;
  prevMacd: number;
  prevSig: number;
}

export interface BollingerBandsIndicator {
  upper: number;
  mid: number;
  lower: number;
  bw: number;
}

export interface PivotPointsIndicator {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface FibonacciIndicator {
  swingHigh: number;
  swingLow: number;
  direction: 'up' | 'down';
  levels: { pct: number; price: number }[];
}

// sma20/sma50/rsi14/macd/bb20 are per-bar SERIES (same newest-first convention as `bars`, one
// entry per bar), not a single current-value reading - a chart overlay needs a value at every
// point, unlike the single-snapshot shape momentum.service.ts's own mwSMA/mwRSI/mwBB/mwMACD
// return for the Momentum feature. Each entry is null until enough trailing bars exist for that
// point (same thresholds candlestick.service.ts's computeAllIndicators() enforces) - every
// consumer in CandlestickPopup.tsx must skip nulls, not assume a value at every index. ema20
// alone was already a full series even before this feature (mwEMA's own native shape).
export interface CandlestickIndicators {
  sma20: (number | null)[];
  sma50: (number | null)[];
  ema20: number[] | null;
  rsi14: (number | null)[];
  macd: (MacdIndicator | null)[];
  bb20: (BollingerBandsIndicator | null)[];
  volume: number[];
  vwap: number[];
  pivotPoints: PivotPointsIndicator | null;
  fibonacci: FibonacciIndicator | null;
}

export interface CandlestickSnapshot {
  bars: CandlestickBar[];
  indicators: CandlestickIndicators;
  updatedAt: string;
  isFresh: boolean;
}

export interface CachedSymbolSummary {
  symbol: string;
  // Which interval produced the most recent pull - what the pop-up defaults to opening on.
  interval: CandlestickInterval;
  updatedAt: string;
  isFresh: boolean;
}

// Backs the new left-side panel - one row per already-cached symbol, green/grey per isFresh.
export function useCachedSymbolsList() {
  return useQuery({
    queryKey: ['candlestick', 'cachedSymbols'],
    queryFn: () => apiFetch<{ symbols: CachedSymbolSummary[] }>('/candlestick/cached-symbols'),
  });
}

// Read-only - never triggers a real fetch server-side. A 404 means "nothing cached for this
// symbol/interval yet," a normal state (not an error) that resolves to `null` data so the
// pop-up can show its confirm-to-fetch prompt instead of an error message.
export function useCandlestickSnapshot(symbol: string | null, interval: CandlestickInterval | null) {
  return useQuery({
    queryKey: ['candlestick', 'snapshot', symbol, interval],
    queryFn: async () => {
      try {
        return await apiFetch<CandlestickSnapshot>(`/candlestick/${encodeURIComponent(symbol!)}/${interval}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: symbol != null && interval != null,
  });
}

// The explicit, confirmed action - the only call in this feature that ever costs the user
// against their rate limit. Seeds the snapshot cache directly with the fresh result (avoids an
// extra round-trip) and invalidates the cached-symbols list so the panel's green/grey state and
// "Time of Pull" reflect it immediately.
export function useRefreshCandlestick() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ symbol, interval }: { symbol: string; interval: CandlestickInterval }) =>
      apiFetch<CandlestickSnapshot>(`/candlestick/${encodeURIComponent(symbol)}/${interval}/refresh`, { method: 'POST' }),
    onSuccess: (data, { symbol, interval }) => {
      queryClient.setQueryData(['candlestick', 'snapshot', symbol, interval], data);
      queryClient.invalidateQueries({ queryKey: ['candlestick', 'cachedSymbols'] });
    },
  });
}
