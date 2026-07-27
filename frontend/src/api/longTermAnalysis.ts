import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

// Mirrors analysis-service/app/models/long_term.py's LongTermAnalysisResponse
// field-for-field — no shared-schema codegen in this repo, keep in sync by
// hand if either shape changes (same caveat as the backend's own copy in
// backend/src/services/analysisService.ts).

export interface GrowthMetric {
  current: number | null;
  prior: number | null;
  yoyPct: number | null;
}

export interface MarginMetric {
  current: number | null;
  prior: number | null;
  deltaPp: number | null;
}

export interface FinancialGrowth {
  fyLabel: string | null;
  fyPrevLabel: string | null;
  revenue: GrowthMetric;
  grossMargin: MarginMetric;
  operatingMargin: MarginMetric;
  eps: GrowthMetric;
  netIncomeGrowthPct: number | null;
}

export interface ValuationMetrics {
  trailingPe: number | null;
  forwardPe: number | null;
  evToEbitda: number | null;
  peerAvgTrailingPe: number | null;
  peerAvgEvToEbitda: number | null;
  peerCount: number;
}

export interface ConvictionResult {
  rating: 'bullish' | 'neutral' | 'bearish';
  score: number;
  rationale: string;
}

export interface AnalystConsensus {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  totalAnalysts: number;
  buyPct: number;
  holdPct: number;
  sellPct: number;
}

export interface PeerQuote {
  symbol: string;
  price: number | null;
  trailingPe: number | null;
  evToEbitda: number | null;
  marketCap: number | null;
}

export interface EarningsSurprise {
  date: string | null;
  epsActual: number | null;
  epsEstimated: number | null;
}

export interface PriceTarget {
  targetConsensus: number | null;
  targetHigh: number | null;
  targetLow: number | null;
}

export interface NewsItem {
  date: string | null;
  title: string;
  source: string | null;
  url: string | null;
}

export interface LongTermAnalysisResult {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  price: number;
  marketCap: number | null;
  beta: number | null;
  range52w: string | null;
  dividend: number | null;
  valuation: ValuationMetrics;
  financials: FinancialGrowth;
  earningsSurprises: EarningsSurprise[];
  priceTarget: PriceTarget | null;
  upsidePct: number | null;
  consensus: AnalystConsensus;
  peers: PeerQuote[];
  peerNote: string;
  bullSignals: string[];
  bearSignals: string[];
  mediumTerm: ConvictionResult;
  longTerm: ConvictionResult;
  news: NewsItem[];
}

// A mutation, not a query — same reasoning as useMomentumAnalysis: this is
// triggered on-demand by a ticker lookup, not something to auto-refetch/
// cache by symbol.
export function useLongTermAnalysis() {
  return useMutation({
    mutationFn: (symbol: string) =>
      apiFetch<LongTermAnalysisResult>(`/analysis/long-term/${encodeURIComponent(symbol)}`),
  });
}
