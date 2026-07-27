import env from '../config/env';
import type {
  EarningsSurprise,
  LongTermAnalysisPayload,
  NewsItem,
  PeerQuote,
  PriceTarget,
} from './longTermAnalysisData.service';

export class AnalysisServiceError extends Error {}

// Mirrors analysis-service/app/models/long_term.py's LongTermAnalysisResponse
// field-for-field (same hand-maintained-duplicate caveat as
// LongTermAnalysisPayload — see longTermAnalysisData.service.ts).
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

export interface ValuationMetrics {
  trailingPe: number | null;
  forwardPe: number | null;
  evToEbitda: number | null;
  peerAvgTrailingPe: number | null;
  peerAvgEvToEbitda: number | null;
  peerCount: number;
}

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

// Small fetch-with-timeout wrapper for the Python analysis-service, mirroring
// marketData.service.ts's fmpGet shape (AbortController + finally-cleared
// timeout) but without any FMP-specific error mapping — nothing FMP-shaped
// to distinguish when talking to our own internal service.
export async function checkHealth(): Promise<{ status: string }> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${env.analysisServiceUrl}/health`, { signal: controller.signal });
    if (!res.ok) throw new AnalysisServiceError(`Analysis service returned HTTP ${res.status}`);
    return (await res.json()) as { status: string };
  } catch (err) {
    if (err instanceof AnalysisServiceError) throw err;
    throw new AnalysisServiceError('Analysis service unavailable.');
  } finally {
    clearTimeout(tid);
  }
}

// Unlike checkHealth, this does real computation over a larger payload
// (grade bucketing, peer averaging) — a longer timeout than the health
// check's 5s, matching fmpGet's own 20s default in marketData.service.ts.
export async function computeLongTermAnalysis(payload: LongTermAnalysisPayload): Promise<LongTermAnalysisResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${env.analysisServiceUrl}/long-term-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new AnalysisServiceError(`Analysis service returned HTTP ${res.status}`);
    return (await res.json()) as LongTermAnalysisResult;
  } catch (err) {
    if (err instanceof AnalysisServiceError) throw err;
    throw new AnalysisServiceError('Analysis service unavailable.');
  } finally {
    clearTimeout(tid);
  }
}
