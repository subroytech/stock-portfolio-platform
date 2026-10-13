// Fetches everything the Contrarian Comeback Analysis feature needs from FMP
// (+ optional Finnhub news), server-side, using the calling user's own
// decrypted keys. Same division of labor as longTermAnalysisData.service.ts:
// this module owns every external call and does field selection/
// normalization only - no gate/score derivation, that's Python's job
// (analysis-service/app/scoring/contrarian_comeback.py). One fetch function,
// called independently by both the gate-preview and submit controller
// handlers (stateless - see contrarian_comeback.py's header comment for why
// that's safe/cheap to do twice) - though a short-lived in-memory cache
// (contrarianComebackCache.service.ts) now short-circuits a same-user Submit
// within 30 minutes of its own Gate before this function is even called again.
//
// TS interfaces below mirror analysis-service/app/models/contrarian_comeback
// .py's Pydantic models field-for-field - no shared-schema codegen in this
// repo, keep both in sync by hand if either shape changes.
//
// Shared daily FMP cache (m_fmp_daily_cache, migration 042, Phase 2 2026-09-07) - every FMP call
// below except quote (which stays live during market hours, folding into the day-cache after
// close - see fmpDailyCache.service.ts's isMarketOpenNow()) is routed through
// fmpDailyCache.getOrFetch() instead of calling fmpGet directly. Symbol-keyed, not per-user, and
// shared with longTermAnalysisData.service.ts's own cached calls - profile/quote/
// income-statement/price-target-consensus/grades are the exact same (symbol, api_name) rows, so
// a symbol already looked up via either feature today benefits the other for free.

import { fmpGet } from './marketData.service';
import * as fmpDailyCache from './fmpDailyCache.service';
import env from '../config/env';
import { InvalidTickerError } from '../utils/errors';

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
  // Usage Audit follow-on (2026-09-06) - real per-provider call counts for this run. Since the
  // daily cache (Phase 2, 2026-09-07) landed, this reflects calls actually made (cache misses /
  // the forced-fresh quote call during market hours), not a fixed formula.
  apiCallCounts?: { fmp: number; finnhub: number };
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
async function fetchFundamentals(symbol: string, fmpKey: string): Promise<FundamentalsRaw & { realCalls: number }> {
  try {
    const [bsResult, cfResult] = await Promise.all([
      fmpDailyCache.getOrFetch(symbol, 'balance-sheet-statement', `GET /balance-sheet-statement?symbol=${symbol}&period=annual&limit=1`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/balance-sheet-statement?symbol=${symbol}&period=annual&limit=1&apikey=${fmpKey}`)),
      fmpDailyCache.getOrFetch(symbol, 'cash-flow-statement', `GET /cash-flow-statement?symbol=${symbol}&period=annual&limit=1`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/cash-flow-statement?symbol=${symbol}&period=annual&limit=1&apikey=${fmpKey}`)),
    ]);
    const bs = first<any>(bsResult.data);
    const cf = first<any>(cfResult.data);
    const realCalls = (bsResult.wasCached ? 0 : 1) + (cfResult.wasCached ? 0 : 1);
    return {
      totalDebt: bs?.totalDebt ?? null,
      totalStockholdersEquity: bs?.totalStockholdersEquity ?? null,
      totalCurrentAssets: bs?.totalCurrentAssets ?? null,
      totalCurrentLiabilities: bs?.totalCurrentLiabilities ?? null,
      cashAndCashEquivalents: bs?.cashAndCashEquivalents ?? null,
      operatingCashFlow: cf?.operatingCashFlow ?? null,
      capitalExpenditure: cf?.capitalExpenditure ?? null,
      realCalls,
    };
  } catch (err) {
    // See fetchFundamentals's counterpart comment in longTermAnalysisData.service.ts - a cache
    // hit can't reach here, so this was a real (failed) attempt. Logged (previously silent).
    console.error(`fetchFundamentals failed for ${symbol}:`, err);
    return { ...EMPTY_FUNDAMENTALS, realCalls: 1 };
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
    fmpDailyCache.getOrFetch(symbol, 'profile', `GET /profile?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/profile?symbol=${symbol}&apikey=${fmpKey}`)),
    // quote stays live while the market is open, same hybrid rule (and same cached row) as
    // longTermAnalysisData.service.ts's own subject quote.
    fmpDailyCache.getOrFetch(symbol, 'quote', `GET /quote?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${symbol}&apikey=${fmpKey}`),
      { forceFresh: fmpDailyCache.isMarketOpenNow() }),
    // limit=5, not 4 - shares the exact same cached row longTermAnalysisData.service.ts already
    // fetches (its own superset-fetch rule), sliced to 4 periods here instead of 3.
    fmpDailyCache.getOrFetch(symbol, 'income-statement', `GET /income-statement?symbol=${symbol}&period=annual&limit=5`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/income-statement?symbol=${symbol}&period=annual&limit=5&apikey=${fmpKey}`)),
    fmpDailyCache.getOrFetch(symbol, 'price-target-consensus', `GET /price-target-consensus?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/price-target-consensus?symbol=${symbol}&apikey=${fmpKey}`)),
    // limit=50 - matches longTermAnalysisData.service.ts's own grades call exactly (standardized
    // 2026-09-07, see that file's own comment) so both features always share one correct row.
    fmpDailyCache.getOrFetch(symbol, 'grades', `GET /grades?symbol=${symbol}&limit=50`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/grades?symbol=${symbol}&limit=50&apikey=${fmpKey}`)),
    fmpDailyCache.getOrFetch(symbol, 'insider-trading', `GET /insider-trading/search?symbol=${symbol}&limit=20`,
      // NOT /v4/insider-trading — confirmed live 2026-07-27 that FMP retired the
      // v4 endpoint ("Legacy Endpoint", 403) for accounts created after
      // 2025-08-31. /stable/insider-trading/search is the current replacement,
      // and unlike the old v4 shape, its field is correctly spelled
      // acquisitionOrDisposition (not acquistionOrDisposition).
      () => fmpGet<any>(`${env.fmpBaseUrl}/insider-trading/search?symbol=${symbol}&limit=20&apikey=${fmpKey}`)),
    fmpDailyCache.getOrFetch(symbol, 'historical-price-eod', `GET /historical-price-eod/full?symbol=${symbol}&limit=1000`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${symbol}&limit=1000&apikey=${fmpKey}`)),
  ]);

  const rejected = critical.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (rejected) throw rejected.reason;

  const criticalResults = critical.map((r) => (r as PromiseFulfilledResult<fmpDailyCache.GetOrFetchResult<any>>).value);
  const [profileResult, quoteResult, incomeResult, ptResult, gradesResult, insiderResult, histResult] = criticalResults;
  const profileRaw = profileResult.data;
  const quoteRaw = quoteResult.data;
  const incomeRaw = incomeResult.data;
  const ptRaw = ptResult.data;
  const gradesRaw = gradesResult.data;
  const insiderRaw = insiderResult.data;
  const histRaw = histResult.data;
  const criticalRealCalls = criticalResults.filter((r) => !r.wasCached).length;

  const profile = first<any>(profileRaw);
  const quote = first<any>(quoteRaw);

  if (!profile || !quote) {
    throw new InvalidTickerError(`No data returned for ${symbol}. Check the ticker symbol or your API key.`);
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
  let etfRealCalls = 0;
  if (etfSymbol) {
    try {
      const etfResult = await fmpDailyCache.getOrFetch(etfSymbol, 'historical-price-eod', `GET /historical-price-eod/full?symbol=${etfSymbol}&limit=260`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${etfSymbol}&limit=260&apikey=${fmpKey}`));
      etfDailyBars = normalizeBars(etfResult.data);
      etfRealCalls = etfResult.wasCached ? 0 : 1;
    } catch (err) {
      // Logged (previously silent) - a cache hit can't reach here, so this was a real (failed)
      // attempt.
      console.error(`ETF historical-price-eod failed for ${etfSymbol}:`, err);
      etfDailyBars = []; // non-critical - Check 3 just degrades to "no ETF data"
      etfRealCalls = 1;
    }
  }

  const [news, fundamentals] = await Promise.all([
    fetchNews(symbol, finnhubKey),
    fetchFundamentals(symbol, fmpKey),
  ]);

  const price = quote.price ?? profile.price ?? 0;
  // profile.pe / quote.pe are both absent on this account's /stable tier
  // (confirmed live during the Long-Term Analysis build - see
  // longTermAnalysisData.service.ts's trailingPe comment). Same fix here:
  // derive trailing P/E from price/EPS using the annual income statement's
  // own eps field, which this call already fetches for the fundamentals
  // above - no extra FMP request needed.
  const eps0 = Array.isArray(incomeRaw) ? (incomeRaw[0]?.eps ?? incomeRaw[0]?.epsDiluted ?? null) : null;
  const peRatio = eps0 && eps0 > 0 && price > 0 ? price / eps0 : null;

  const { realCalls: fundamentalsRealCalls, ...fundamentalsData } = fundamentals;
  const fmpCallCount = criticalRealCalls + etfRealCalls + fundamentalsRealCalls;

  return {
    symbol,
    companyName: profile.companyName ?? null,
    sector,
    exchange: profile.exchange ?? null,
    price,
    marketCap: profile.mktCap ?? quote.marketCap ?? null,
    yearHigh: quote.yearHigh ?? null,
    peRatio,
    incomeStatements,
    dailyBars,
    etfSymbol,
    etfDailyBars,
    priceTarget,
    grades,
    insiderTrades,
    news,
    ...fundamentalsData,
    apiCallCounts: { fmp: fmpCallCount, finnhub: finnhubKey ? 1 : 0 },
  };
}
