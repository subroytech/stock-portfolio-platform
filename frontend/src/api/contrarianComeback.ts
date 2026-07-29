import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

// Mirrors analysis-service/app/models/contrarian_comeback.py field-for-field
// - no shared-schema codegen in this repo, keep in sync by hand if either
// shape changes (same caveat as backend/src/services/analysisService.ts's
// own copy).

export interface NewsItem {
  date: string | null;
  title: string;
  source: string | null;
  url: string | null;
}

export interface ContrarianComebackGateResult {
  symbol: string;
  check1Pass: boolean;
  drawdownPct: number;
  dd52w: number;
  dd4y: number;
  check3Status: 'pass' | 'override_available' | 'hard_block';
  etfSymbol: string | null;
  etfReturn6M: number | null;
  check4Pass: boolean;
  recentNews: NewsItem[];
  insiderSignal: string;
  insiderBuys: number;
  insiderSells: number;
  analystUpgrades90d: number;
  analystDowngrades90d: number;
  priceTargetAvg: number | null;
  analystUpsidePct: number | null;
  failedCheck: string | null;
  reason: string | null;
  route: string | null;
}

export interface ScoreBreakdown {
  breakdown: number;
  sector: number;
  technical: number;
  value: number;
  catalyst: number;
  total: number;
  verdict: 'HIGH' | 'MODERATE' | 'SPECULATIVE' | 'AVOID';
  hybridCapActive: boolean;
  sectorOverrideCapActive: boolean;
}

export interface WeeklyTechnicals {
  weeklyRsi: number | null;
  obvTrend: 'up' | 'down' | 'flat' | 'insufficient_data';
  volumeDrying: boolean;
  sma200w: number | null;
}

export interface FibonacciLevels {
  swingLow: number;
  athPrice: number;
  fib382: number;
  fib618: number;
  fib100: number;
}

export interface InsiderTrade {
  transactionDate: string | null;
  transactionType: string | null;
  acquisitionOrDisposition: string | null;
  securitiesTransacted: number | null;
  price: number | null;
  reportingName: string | null;
}

export interface GradeRecord {
  gradingCompany: string | null;
  newGrade: string | null;
  action: string | null;
  date: string | null;
}

export interface FundamentalMetric {
  value: number | null;
  tier: 'green' | 'yellow' | 'red' | null;
}

export interface FundamentalHealth {
  debtToEquity: FundamentalMetric;
  currentRatio: FundamentalMetric;
  freeCashFlow: FundamentalMetric;
  revenueGrowthPct: FundamentalMetric;
  grossMarginPct: FundamentalMetric;
  cashRunwayMonths: FundamentalMetric;
  positiveFcf: boolean;
}

export interface CatalystPipeline {
  recentInsiderTrades: InsiderTrade[];
  recentGrades: GradeRecord[];
  news: NewsItem[];
}

export interface TrancheEntry {
  label: string;
  sizePct: number;
  priceLow: number;
  priceHigh: number;
  trigger: string;
}

export interface StagedEntry {
  tranches: TrancheEntry[];
  hardStop: number;
  capLabel: 'Large-Cap' | 'Mid-Cap' | 'Small-Cap';
  isMidCap: boolean;
}

export interface RecoveryTarget {
  label: string;
  horizon: string;
  price: number;
  returnPct: number;
}

export interface AnalystConsensusTarget {
  low: number;
  high: number;
  average: number;
  returnPct: number;
}

export interface RecoveryTargets {
  conservative: RecoveryTarget;
  baseCase: RecoveryTarget;
  bullCase: RecoveryTarget;
  analystConsensus: AnalystConsensusTarget | null;
  riskRewardRatio: number | null;
}

export interface ContrarianComebackSubmitResult {
  symbol: string;
  format: 'A' | 'B';
  failedCheck: string | null;
  reason: string | null;
  route: string | null;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
  price: number | null;
  drawdownPct: number | null;
  breakdownTypes: string[];
  hybridCap: boolean;
  check3Override: boolean;
  check3OverrideReason: string | null;
  etfSymbol: string | null;
  etfReturn6M: number | null;
  score: ScoreBreakdown | null;
  technicals: WeeklyTechnicals | null;
  fibonacci: FibonacciLevels | null;
  fundamentalHealth: FundamentalHealth | null;
  catalystPipeline: CatalystPipeline | null;
  stagedEntry: StagedEntry | null;
  recoveryTargets: RecoveryTargets | null;
}

export interface ContrarianComebackSubmitInput {
  symbol: string;
  breakdownTypes: string[];
  catalystAnswer: 'yes' | 'no';
  check3Override?: boolean;
  check3OverrideReason?: string;
}

// A mutation, not a query - same reasoning as useLongTermAnalysis: both are
// triggered on-demand by a ticker lookup, not something to auto-refetch/
// cache by symbol.
export function useContrarianComebackGate() {
  return useMutation({
    mutationFn: (symbol: string) =>
      apiFetch<ContrarianComebackGateResult>(`/analysis/contrarian-comeback/${encodeURIComponent(symbol)}/gate`),
  });
}

export function useContrarianComebackSubmit() {
  return useMutation({
    mutationFn: ({ symbol, ...body }: ContrarianComebackSubmitInput) =>
      apiFetch<ContrarianComebackSubmitResult>(`/analysis/contrarian-comeback/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}
