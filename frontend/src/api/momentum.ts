import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { RATE_LIMIT_STATUS_QUERY_KEY } from './rateLimitStatus';

export interface MacdResult {
  macd: number;
  signal: number;
  hist: number;
  prevMacd: number;
  prevSig: number;
}

export interface BollingerBands {
  upper: number;
  mid: number;
  lower: number;
  bw: number;
}

export interface MomentumScoreBreakdown {
  rsi: number;
  macd: number;
  volume: number;
  trend: number;
  riskReward: number;
  total: number;
}

export type MomentumSignal = 'STRONG BUY' | 'BUY' | 'WATCH' | 'AVOID';

export interface MomentumAnalysis {
  price: number;
  sma20: number;
  sma50: number;
  rsi: number;
  macd: MacdResult;
  bb: BollingerBands;
  volRatio: number;
  dayChg: number;
  score: MomentumScoreBreakdown;
  signal: MomentumSignal;
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  target: number;
  rr: number;
  flags: string[];
  extras: string[];
}

export interface MomentumResponse {
  symbol: string;
  name: string | null;
  analysis: MomentumAnalysis;
}

// A mutation, not a query — this is triggered on-demand by a ticker lookup
// (button press), not something to auto-refetch/cache by symbol.
export function useMomentumAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (symbol: string) => apiFetch<MomentumResponse>(`/momentum/${encodeURIComponent(symbol)}`),
    // Momentum counts against the combined rate limit - refresh the header indicator right
    // after this settles (success or a 429) rather than waiting for its own poll interval.
    onSettled: () => queryClient.invalidateQueries({ queryKey: RATE_LIMIT_STATUS_QUERY_KEY }),
  });
}
