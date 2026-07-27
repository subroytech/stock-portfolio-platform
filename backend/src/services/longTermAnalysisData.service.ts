// Fetches everything the Long-Term Analysis feature needs from FMP (+ an
// optional Finnhub news call), server-side, using the calling user's own
// decrypted keys. This module owns every external call and does field
// selection/normalization only — no scoring/derivation, that's Python's job
// (analysis-service/app/scoring/long_term.py). Endpoints ported from
// CreateStockPortfolioViewWOSkill/lt-analysis.html, run in parallel here
// (that app ran them sequentially only to drive a step-by-step loading UI,
// which doesn't apply server-side).
//
// TS interfaces below mirror analysis-service/app/models/long_term.py's
// Pydantic models field-for-field — there's no shared-schema codegen in this
// repo, so keep both in sync by hand if either shape changes.

import { fmpGet } from './marketData.service';
import env from '../config/env';

export interface IncomeStatementPeriod {
  fiscalYear: string | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
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

export interface AnalystGrade {
  gradingCompany: string;
  newGrade: string;
  date: string;
}

export interface PeerQuote {
  symbol: string;
  price: number | null;
  trailingPe: number | null;
  evToEbitda: number | null;
  marketCap: number | null;
}

export interface NewsItem {
  date: string | null;
  title: string;
  source: string | null;
  url: string | null;
}

export interface LongTermAnalysisPayload {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  price: number;
  marketCap: number | null;
  beta: number | null;
  range52w: string | null;
  lastDividend: number | null;
  incomeStatements: IncomeStatementPeriod[];
  earningsSurprises: EarningsSurprise[];
  priceTarget: PriceTarget | null;
  grades: AnalystGrade[];
  peers: PeerQuote[];
  forwardEpsEstimate: number | null;
  evToEbitda: number | null;
  news: NewsItem[];
}

function first<T = any>(data: T[] | T | null | undefined): T | null {
  if (data == null) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function fetchPeerData(
  symbol: string,
  fmpKey: string,
): Promise<PeerQuote[]> {
  try {
    // /stable/stock-peers returns the peer list directly as a flat array of
    // {symbol, companyName, price, mktCap} objects — NOT wrapped in a
    // {peersList: [...]} envelope the way the source app's (older/legacy
    // tier) response shape had it. Confirmed against a live account 2026-07-26.
    const peersData = await fmpGet<any[]>(`${env.fmpBaseUrl}/stock-peers?symbol=${symbol}&apikey=${fmpKey}`);
    const peerSymbols: string[] = Array.isArray(peersData)
      ? peersData.slice(0, 4).map((p) => p?.symbol).filter((s): s is string => Boolean(s))
      : [];
    if (!peerSymbols.length) return [];

    const [quoteResults, keyMetricsResults] = await Promise.all([
      Promise.allSettled(peerSymbols.map((sym) => fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${fmpKey}`))),
      Promise.allSettled(peerSymbols.map((sym) => fmpGet<any>(`${env.fmpBaseUrl}/key-metrics?symbol=${sym}&apikey=${fmpKey}`))),
    ]);

    return peerSymbols.map((sym, i) => {
      const q = quoteResults[i].status === 'fulfilled' ? first<any>((quoteResults[i] as PromiseFulfilledResult<any>).value) : null;
      const km = keyMetricsResults[i].status === 'fulfilled' ? first<any>((keyMetricsResults[i] as PromiseFulfilledResult<any>).value) : null;
      // /stable/quote has no `pe` field (confirmed live 2026-07-26 — same gap
      // as profile.pe, which is why the subject's own trailingPe is computed
      // from price/eps0 rather than trusted from FMP directly). key-metrics'
      // `earningsYield` (E/P) is already being fetched for evToEBITDA, so
      // its reciprocal gives peer P/E without an extra call per peer.
      const trailingPe = km?.earningsYield && km.earningsYield > 0 ? 1 / km.earningsYield : null;
      return {
        symbol: sym,
        price: q?.price ?? null,
        trailingPe,
        evToEbitda: km?.evToEBITDA ?? km?.enterpriseValueOverEBITDA ?? null,
        marketCap: q?.marketCap ?? null,
      };
    });
  } catch {
    return []; // non-critical — peer data never blocks the report
  }
}

async function fetchForwardEpsEstimate(symbol: string, fmpKey: string): Promise<number | null> {
  try {
    const rows = await fmpGet<any[]>(`${env.fmpBaseUrl}/financial-estimates?symbol=${symbol}&period=annual&apikey=${fmpKey}`);
    if (!Array.isArray(rows) || !rows.length) return null;
    const currentYear = new Date().getFullYear();
    const future = rows
      .filter((r) => r?.date && parseInt(String(r.date).slice(0, 4), 10) >= currentYear)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return future[0]?.epsAvg ?? null;
  } catch {
    return null; // non-critical — display/scoring degrades gracefully to null
  }
}

async function fetchEvToEbitda(symbol: string, fmpKey: string): Promise<number | null> {
  try {
    const row = first<any>(await fmpGet<any>(`${env.fmpBaseUrl}/key-metrics?symbol=${symbol}&apikey=${fmpKey}`));
    return row?.evToEBITDA ?? row?.enterpriseValueOverEBITDA ?? null;
  } catch {
    return null;
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
    return data.slice(0, 15).map((n: any) => ({
      date: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : null,
      title: n.headline || n.title || '',
      source: n.source || null,
      url: n.url || null,
    }));
  } catch {
    return []; // soft — news never blocks the report, matches source app
  }
}

export async function fetchLongTermAnalysisData(
  symbol: string,
  fmpKey: string,
  finnhubKey?: string,
): Promise<LongTermAnalysisPayload> {
  const critical = await Promise.allSettled([
    fmpGet<any>(`${env.fmpBaseUrl}/profile?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/income-statement?symbol=${symbol}&period=annual&limit=3&apikey=${fmpKey}`),
    // NOT /earnings-calendar — confirmed live 2026-07-26 that endpoint ignores
    // the symbol param entirely and returns the market-wide calendar for that
    // date. /earnings is the correct per-symbol actual-vs-estimate history.
    fmpGet<any>(`${env.fmpBaseUrl}/earnings?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/price-target-consensus?symbol=${symbol}&apikey=${fmpKey}`),
    fmpGet<any>(`${env.fmpBaseUrl}/grades?symbol=${symbol}&apikey=${fmpKey}`),
  ]);

  const rejected = critical.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (rejected) throw rejected.reason;

  const [profileRaw, quoteRaw, incomeRaw, surpriseRaw, ptRaw, gradesRaw] = critical.map(
    (r) => (r as PromiseFulfilledResult<any>).value,
  );

  const profile = first<any>(profileRaw);
  const quote = first<any>(quoteRaw);

  const incomeStatements: IncomeStatementPeriod[] = (Array.isArray(incomeRaw) ? incomeRaw : [])
    .slice(0, 3)
    .map((i: any) => ({
      fiscalYear: i.fiscalYear ?? null,
      revenue: i.revenue ?? null,
      grossProfit: i.grossProfit ?? null,
      operatingIncome: i.operatingIncome ?? null,
      netIncome: i.netIncome ?? null,
      eps: i.eps ?? i.epsDiluted ?? null,
    }));

  // epsActual != null only — /stable/earnings also returns not-yet-reported
  // future quarters (epsEstimated set, epsActual still null); including those
  // would let an upcoming estimate-only row sort to "most recent" ahead of
  // the last genuinely reported quarter, corrupting the surprise-% calc.
  const earningsSurprises: EarningsSurprise[] = (Array.isArray(surpriseRaw) ? surpriseRaw : [])
    .filter((s: any) => s.epsActual != null)
    .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 4)
    .map((s: any) => ({ date: s.date ?? null, epsActual: s.epsActual ?? null, epsEstimated: s.epsEstimated ?? null }));

  const ptRow = first<any>(ptRaw);
  const priceTarget: PriceTarget | null = ptRow
    ? {
        targetConsensus: ptRow.targetConsensus ?? ptRow.targetMedian ?? null,
        targetHigh: ptRow.targetHigh ?? null,
        targetLow: ptRow.targetLow ?? null,
      }
    : null;

  const grades: AnalystGrade[] = (Array.isArray(gradesRaw) ? gradesRaw : [])
    .filter((g: any) => g?.gradingCompany && g?.newGrade && g?.date)
    .map((g: any) => ({ gradingCompany: g.gradingCompany, newGrade: g.newGrade, date: g.date }));

  // Non-critical enrichment — failures here degrade gracefully, never block the report.
  const [peers, forwardEpsEstimate, evToEbitda, news] = await Promise.all([
    fetchPeerData(symbol, fmpKey),
    fetchForwardEpsEstimate(symbol, fmpKey),
    fetchEvToEbitda(symbol, fmpKey),
    fetchNews(symbol, finnhubKey),
  ]);

  if (!profile || !quote) {
    throw new Error(`No data returned for ${symbol}. Check the ticker symbol or your API key.`);
  }

  return {
    symbol,
    companyName: profile.companyName ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    exchange: profile.exchange ?? null,
    price: quote.price ?? profile.price ?? 0,
    marketCap: profile.marketCap ?? null,
    beta: profile.beta ?? null,
    range52w: profile.range ?? null,
    lastDividend: profile.lastDividend ?? null,
    incomeStatements,
    earningsSurprises,
    priceTarget,
    grades,
    peers,
    forwardEpsEstimate,
    evToEbitda,
    news,
  };
}
