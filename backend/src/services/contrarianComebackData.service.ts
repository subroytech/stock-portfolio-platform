// Fetches everything the Contrarian Comeback Analysis feature needs from FMP
// (+ optional Finnhub news), server-side, using the calling user's own
// decrypted keys. Same division of labor as longTermAnalysisData.service.ts:
// this module owns every external call and does field selection/
// normalization only - no gate/score derivation, that's Python's job
// (analysis-service/app/scoring/contrarian_comeback.py). One fetch function,
// called independently by both the gate-preview and submit controller
// handlers (stateless - see contrarian_comeback.py's header comment for why
// that's safe/cheap to do twice).
//
// TS interfaces below mirror analysis-service/app/models/contrarian_comeback
// .py's Pydantic models field-for-field - no shared-schema codegen in this
// repo, keep both in sync by hand if either shape changes.

import { fmpGet } from './marketData.service';
import env from '../config/env';

// Sector -> SPDR ETF map, ported from CreateStockPortfolioViewWOSkill/js/
// utils.js's SECTOR_ETF. Keyed by FMP profile.sector (which - unlike
// /quote - does have a sector field, so no m_tickers-style DB backfill is
// needed here the way Contrarian Finder needed one).
export const SECTOR_ETF: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  'Financial Services': 'XLF',
  Energy: 'XLE',
  'Communication Services': 'XLC',
  'Consumer Cyclical': 'XLY',
  'Consumer Defensive': 'XLP',
  Industrials: 'XLI',
  'Basic Materials': 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
};

export interface DailyBar {
  date: string;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface PriceTargetInfo {
  targetConsensus: number | null;
  targetHigh: number | null;
  targetLow: number | null;
}

export interface GradeRecord {
  gradingCompany: string | null;
  newGrade: string | null;
  action: string | null;
  date: string | null;
}

export interface InsiderTrade {
  transactionDate: string | null;
  transactionType: string | null;
  acquisitionOrDisposition: string | null;
  securitiesTransacted: number | null;
  price: number | null;
  reportingName: string | null;
}

export interface NewsItem {
  date: string | null;
  title: string;
  source: string | null;
  url: string | null;
}

export interface IncomeStatementPeriod {
  revenue: number | null;
  grossProfit: number | null;
}

export interface ContrarianComebackData {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
  price: number;
  marketCap: number | null;
  yearHigh: number | null;
  peRatio: number | null;
  incomeStatements: IncomeStatementPeriod[]; // 2 most recent annual periods, newest first
  dailyBars: DailyBar[]; // newest-first, up to 1000 bars
  etfSymbol: string | null;
  etfDailyBars: DailyBar[]; // newest-first, up to 260 bars; empty if no ETF mapped
  priceTarget: PriceTargetInfo | null;
  grades: GradeRecord[];
  insiderTrades: InsiderTrade[];
  news: NewsItem[];
  // Phase 2 - most recent annual balance-sheet / cash-flow figures only (no
  // prior-year comparison needed for DE/currentR/FCF/cashRun, unlike revenue growth).
  totalDebt: number | null;
  totalStockholdersEquity: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  cashAndCashEquivalents: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
}

function first<T = any>(data: T[] | T | null | undefined): T | null {
  if (data == null) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function normalizeBars(raw: any): DailyBar[] {
  const arr = Array.isArray(raw) ? raw : (raw?.historical || []);
  return arr.map((b: any) => ({
    date: b.date,
    high: b.high ?? null,
    low: b.low ?? null,
    close: b.close ?? null,
    volume: b.volume ?? null,
  }));
}

interface FundamentalsRaw {
  totalDebt: number | null;
  totalStockholdersEquity: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  cashAndCashEquivalents: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
}

const EMPTY_FUNDAMENTALS: FundamentalsRaw = {
  totalDebt: null, totalStockholdersEquity: null, totalCurrentAssets: null,
  totalCurrentLiabilities: null, cashAndCashEquivalents: null, operatingCashFlow: null, capitalExpenditure: null,
};

// Non-critical, like the ETF/news fetches below - a stock with no balance-
// sheet/cash-flow data on this account's FMP tier just degrades to null
// tiers in Fundamental Health, it never blocks the gate/score report.
async function fetchFundamentals(symbol: string, fmpKey: string): Promise<FundamentalsRaw> {
  try {
    const [bsRaw, cfRaw] = await Promise.all([
      fmpGet<any>(`${env.fmpBaseUrl}/balance-sheet-statement?symbol=${symbol}&period=annual&limit=1&apikey=${fmpKey}`),
      fmpGet<any>(`${env.fmpBaseUrl}/cash-flow-statement?symbol=${symbol}&period=annual&limit=1&apikey=${fmpKey}`),
    ]);
    const bs = first<any>(bsRaw);
    const cf = first<any>(cfRaw);
    return {
      totalDebt: bs?.totalDebt ?? null,
      totalStockholdersEquity: bs?.totalStockholdersEquity ?? null,
      totalCurrentAssets: bs?.totalCurrentAssets ?? null,
      totalCurrentLiabilities: bs?.totalCurrentLiabilities ?? null,
      cashAndCashEquivalents: bs?.cashAndCashEquivalents ?? null,
      operatingCashFlow: cf?.operatingCashFlow ?? null,
      capitalExpenditure: cf?.capitalExpenditure ?? null,
    };
  } catch {
    return EMPTY_FUNDAMENTALS;
  }
}

async function fetchNews(symbol: string, finnhubKey: string | undefined): Promise<NewsItem[]> {
  if (!finnhubKey) return [];
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const res = await fetch(`${env.finnhubBaseUrl}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${finnhubKey}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map((n: any) => ({
      date: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : null,
      title: n.headline || n.title || '',
      source: n.source || null,
      url: n.url || null,
    }));
  } catch {
    return []; // soft - news never blocks the report, matches source app / Long-Term Analysis
  }
}

export async function fetchContrarianComebackData(
  symbol: string,
  fmpKey: string,
  finnhubKey?: string,
): Promise<ContrarianComebackData> {
  const critical = await Promise.allSettled([
    fmpGet<any>(`${env.fmpBaseUrl}/profile?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/income-statement?symbol=${symbol}&period=annual&limit=4&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/price-target-consensus?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/grades?symbol=${symbol}&limit=50&apikey=${fmpKey}`),
    // NOT /v4/insider-trading — confirmed live 2026-07-27 that FMP retired the
    // v4 endpoint ("Legacy Endpoint", 403) for accounts created after
    // 2025-08-31. /stable/insider-trading/search is the current replacement,
    // and unlike the old v4 shape, its field is correctly spelled
    // acquisitionOrDisposition (not acquistionOrDisposition).
    fmpGet<any>(`${env.fmpBaseUrl}/insider-trading/search?symbol=${symbol}&limit=20&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${symbol}&limit=1000&apikey=${fmpKey}`),
  ]);

  const rejected = critical.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (rejected) throw rejected.reason;

  const [profileRaw, quoteRaw, incomeRaw, ptRaw, gradesRaw, insiderRaw, histRaw] = critical.map(
    (r) => (r as PromiseFulfilledResult<any>).value,
  );

  const profile = first<any>(profileRaw);
  const quote = first<any>(quoteRaw);

  if (!profile || !quote) {
    throw new Error(`No data returned for ${symbol}. Check the ticker symbol or your API key.`);
  }

  const incomeStatements: IncomeStatementPeriod[] = (Array.isArray(incomeRaw) ? incomeRaw : [])
    .slice(0, 2)
    .map((i: any) => ({ revenue: i.revenue ?? null, grossProfit: i.grossProfit ?? null }));

  const ptRow = first<any>(ptRaw);
  const priceTarget: PriceTargetInfo | null = ptRow
    ? {
        targetConsensus: ptRow.targetConsensus ?? ptRow.targetMedian ?? null,
        targetHigh: ptRow.targetHigh ?? null,
        targetLow: ptRow.targetLow ?? null,
      }
    : null;

  const grades: GradeRecord[] = (Array.isArray(gradesRaw) ? gradesRaw : []).map((g: any) => ({
    gradingCompany: g.gradingCompany ?? null,
    newGrade: g.newGrade ?? null,
    action: g.action ?? null,
    date: g.date ?? null,
  }));

  const insiderTrades: InsiderTrade[] = (Array.isArray(insiderRaw) ? insiderRaw : (insiderRaw?.data || []))
    .slice(0, 20)
    .map((t: any) => ({
      transactionDate: t.transactionDate ?? t.filingDate ?? null,
      transactionType: t.transactionType ?? null,
      acquisitionOrDisposition: t.acquisitionOrDisposition ?? null,
      securitiesTransacted: t.securitiesTransacted ?? null,
      price: t.price ?? t.transactionPrice ?? null,
      reportingName: t.reportingName ?? t.insiderName ?? null,
    }));

  const dailyBars = normalizeBars(histRaw);

  const sector = profile.sector || null;
  const etfSymbol = sector ? (SECTOR_ETF[sector] ?? null) : null;

  let etfDailyBars: DailyBar[] = [];
  if (etfSymbol) {
    try {
      const etfRaw = await fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${etfSymbol}&limit=260&apikey=${fmpKey}`);
      etfDailyBars = normalizeBars(etfRaw);
    } catch {
      etfDailyBars = []; // non-critical - Check 3 just degrades to "no ETF data"
    }
  }

  const [news, fundamentals] = await Promise.all([
    fetchNews(symbol, finnhubKey),
    fetchFundamentals(symbol, fmpKey),
  ]);

  return {
    symbol,
    companyName: profile.companyName ?? null,
    sector,
    exchange: profile.exchange ?? null,
    price: quote.price ?? profile.price ?? 0,
    marketCap: profile.mktCap ?? quote.marketCap ?? null,
    yearHigh: quote.yearHigh ?? null,
    peRatio: profile.pe ?? quote.pe ?? null,
    incomeStatements,
    dailyBars,
    etfSymbol,
    etfDailyBars,
    priceTarget,
    grades,
    insiderTrades,
    news,
    ...fundamentals,
  };
}
