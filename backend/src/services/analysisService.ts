import env from '../config/env';
import type {
  EarningsSurprise,
  LongTermAnalysisPayload,
  NewsItem,
  PeerQuote,
  PriceTarget,
} from './longTermAnalysisData.service';
import type { ContrarianComebackData, GradeRecord, InsiderTrade } from './contrarianComebackData.service';

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

// Mirrors analysis-service/app/models/contrarian_comeback.py field-for-field
// (same hand-maintained-duplicate caveat as the Long-Term Analysis types above).
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

export interface ContrarianComebackScoreBreakdown {
  breakdown: number;
  sector: number;
  technical: number;
  value: number;
  catalyst: number;
  total: number;
  verdict: 'HIGH' | 'MODERATE' | 'SPECULATIVE' | 'AVOID';
  hybridCapActive: boolean;
  sectorOverrideCapActive: boolean;
  hints: Record<string, string>;
}

export interface ContrarianComebackWeeklyTechnicals {
  weeklyRsi: number | null;
  obvTrend: 'up' | 'down' | 'flat' | 'insufficient_data';
  volumeDrying: boolean;
  sma200w: number | null;
  volumeRatioPct: number | null;
  volumeClimax: boolean;
}

export interface ContrarianComebackFibonacciLevels {
  swingLow: number;
  athPrice: number;
  fib382: number;
  fib618: number;
  fib100: number;
}

export interface ContrarianComebackFundamentalMetric {
  value: number | null;
  tier: 'green' | 'yellow' | 'red' | null;
}

export interface ContrarianComebackFundamentalHealth {
  debtToEquity: ContrarianComebackFundamentalMetric;
  currentRatio: ContrarianComebackFundamentalMetric;
  freeCashFlow: ContrarianComebackFundamentalMetric;
  revenueGrowthPct: ContrarianComebackFundamentalMetric;
  grossMarginPct: ContrarianComebackFundamentalMetric;
  cashRunwayMonths: ContrarianComebackFundamentalMetric;
  positiveFcf: boolean;
}

export interface ContrarianComebackCatalystPipeline {
  recentInsiderTrades: InsiderTrade[];
  recentGrades: GradeRecord[];
  news: NewsItem[];
  insiderSignal: string;
  analystUpgrades90d: number;
}

export interface ContrarianComebackValueDislocation {
  peRatio: number | null;
  priceToSales: number | null;
  analystUpsidePct: number;
  sanityCheckTriggered: boolean;
}

export interface ContrarianComebackTrancheEntry {
  label: string;
  sizePct: number;
  priceLow: number;
  priceHigh: number;
  trigger: string;
}

export interface ContrarianComebackStagedEntry {
  tranches: ContrarianComebackTrancheEntry[];
  hardStop: number;
  capLabel: 'Large-Cap' | 'Mid-Cap' | 'Small-Cap';
  isMidCap: boolean;
}

export interface ContrarianComebackRecoveryTarget {
  label: string;
  horizon: string;
  price: number;
  returnPct: number;
}

export interface ContrarianComebackAnalystConsensusTarget {
  low: number;
  high: number;
  average: number;
  returnPct: number;
}

export interface ContrarianComebackRecoveryTargets {
  conservative: ContrarianComebackRecoveryTarget;
  baseCase: ContrarianComebackRecoveryTarget;
  bullCase: ContrarianComebackRecoveryTarget;
  analystConsensus: ContrarianComebackAnalystConsensusTarget | null;
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
  score: ContrarianComebackScoreBreakdown | null;
  technicals: ContrarianComebackWeeklyTechnicals | null;
  fibonacci: ContrarianComebackFibonacciLevels | null;
  fundamentalHealth: ContrarianComebackFundamentalHealth | null;
  catalystPipeline: ContrarianComebackCatalystPipeline | null;
  stagedEntry: ContrarianComebackStagedEntry | null;
  recoveryTargets: ContrarianComebackRecoveryTargets | null;
  valueDislocation: ContrarianComebackValueDislocation | null;
}

export interface ContrarianComebackSubmitPayload extends ContrarianComebackData {
  breakdownTypes: string[];
  catalystAnswer: 'yes' | 'no';
  check3Override: boolean;
  check3OverrideReason: string | null;
}

async function postToAnalysisService<T>(path: string, payload: unknown): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${env.analysisServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new AnalysisServiceError(`Analysis service returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof AnalysisServiceError) throw err;
    throw new AnalysisServiceError('Analysis service unavailable.');
  } finally {
    clearTimeout(tid);
  }
}

export function computeContrarianComebackGate(payload: ContrarianComebackData): Promise<ContrarianComebackGateResult> {
  return postToAnalysisService<ContrarianComebackGateResult>('/contrarian-comeback/gate', payload);
}

export function computeContrarianComebackSubmit(payload: ContrarianComebackSubmitPayload): Promise<ContrarianComebackSubmitResult> {
  return postToAnalysisService<ContrarianComebackSubmitResult>('/contrarian-comeback', payload);
}

// Mirrors analysis-service/app/models/momentum.py field-for-field (same
// hand-maintained-duplicate caveat as the other proxied features above).
// calcKellySizing has no equivalent here - it stays client-side only
// (frontend/src/lib/kelly.ts), never round-trips through this gateway.
export interface MomentumAnalysisPayload {
  closes: number[];
  lows: number[];
  volumes: number[];
  price: number;
}

export interface MomentumMacdResult {
  macd: number;
  signal: number;
  hist: number;
  prevMacd: number;
  prevSig: number;
}

export interface MomentumBollingerBands {
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

export interface MomentumAnalysisResult {
  price: number;
  sma20: number;
  sma50: number;
  rsi: number;
  macd: MomentumMacdResult;
  bb: MomentumBollingerBands;
  volRatio: number;
  dayChg: number;
  score: MomentumScoreBreakdown;
  signal: 'STRONG BUY' | 'BUY' | 'WATCH' | 'AVOID';
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  target: number;
  rr: number;
  flags: string[];
  extras: string[];
}

export function computeMomentumAnalysis(payload: MomentumAnalysisPayload): Promise<MomentumAnalysisResult> {
  return postToAnalysisService<MomentumAnalysisResult>('/momentum-analysis', payload);
}

// Mirrors analysis-service/app/models/contrarian_finder.py field-for-field.
// `source` on ContrarianFinderScanResult has no Python equivalent - Node
// attaches it (from the UniverseEntry the batch was built from) after this
// call returns, same as the sector-map fallback overlay.
export interface ContrarianFinderRawQuoteData {
  price: number | null;
  marketCap: number | null;
  name: string | null;
  sector: string | null;
  volume: number | null;
  avgVolume: number | null;
}

export interface ContrarianFinderRawHistoricalBar {
  date: string | null;
  close: number | null;
  low: number | null;
}

export interface ContrarianFinderRawStockData {
  symbol: string;
  quote: ContrarianFinderRawQuoteData | null;
  historicalBars: ContrarianFinderRawHistoricalBar[];
}

export interface ContrarianFinderScanQuality {
  minPrice: number;
  minMarketCap: number;
}

export interface ContrarianFinderScanBatchPayload {
  stocks: ContrarianFinderRawStockData[];
  quality: ContrarianFinderScanQuality;
  scanDays: number;
}

export interface ContrarianFinderStrengthSignal {
  rsi: number;
  sma20: number;
  sma50: number;
  rr: number;
  kF: number;
  halfKelly: number;
}

export interface ContrarianFinderScanResult {
  symbol: string;
  filterFail: boolean;
  noData?: boolean;
  error?: boolean;
  name?: string;
  sector?: string;
  price?: number | null;
  mktCap?: number | null;
  volume?: number | null;
  avgVol?: number | null;
  changePct?: number;
  changeSinceDate?: string;
  mktClosed?: boolean;
  strength?: ContrarianFinderStrengthSignal | null;
  source?: string;
}

export function computeContrarianFinderScanBatch(payload: ContrarianFinderScanBatchPayload): Promise<ContrarianFinderScanResult[]> {
  return postToAnalysisService<ContrarianFinderScanResult[]>('/contrarian-finder/scan-batch', payload);
}
