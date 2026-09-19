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
//
// Shared daily FMP cache (m_fmp_daily_cache, migration 042, 2026-09-07) — most of these calls
// return data that's effectively static for a full US trading day, so every FMP call below is
// routed through fmpDailyCache.getOrFetch() instead of calling fmpGet directly. Symbol-keyed,
// not per-user: the first lookup of a symbol on a given day pays the real cost, every other
// lookup of that symbol that day pays nothing for the cached calls.
//
// Exactly one call stays realtime: the subject's own quote, live during market hours (see
// fmpDailyCache.service.ts's isMarketOpenNow()) — the one number a user is actually looking at.
// Peer quotes (used only for relative valuation ratios, where a few hours of staleness barely
// moves the comparison) are day-cached like everything else, not forced fresh.

import { fmpGet } from './marketData.service';
import * as fmpDailyCache from './fmpDailyCache.service';
import env from '../config/env';
import { InvalidTickerError } from '../utils/errors';

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
  // Usage Audit follow-on (2026-09-06) - real per-provider call counts for this run, so
  // analysis.controller.ts can log real volume instead of an implicit "1 event = 1 call".
  // Since the daily cache (2026-09-07) landed, this now reflects calls actually made (cache
  // misses / forced-fresh quote calls during market hours), not a fixed formula - a repeat
  // same-day lookup logs a real, much lower number.
  // Optional - not part of computeLongTermAnalysis()'s contract with the Python
  // analysis-service; the controller reads it directly off fetchLongTermAnalysisData()'s
  // return rather than passing it through.
  apiCallCounts?: { fmp: number; finnhub: number };
}

function first<T = any>(data: T[] | T | null | undefined): T | null {
  if (data == null) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

async function fetchPeerData(
  symbol: string,
  fmpKey: string,
): Promise<{ peers: PeerQuote[]; realCalls: number }> {
  try {
    // /stable/stock-peers returns the peer list directly as a flat array of
    // {symbol, companyName, price, mktCap} objects — NOT wrapped in a
    // {peersList: [...]} envelope the way the source app's (older/legacy
    // tier) response shape had it. Confirmed against a live account 2026-07-26.
    const peersResult = await fmpDailyCache.getOrFetch(
      symbol, 'stock-peers', `GET /stock-peers?symbol=${symbol}`,
      () => fmpGet<any[]>(`${env.fmpBaseUrl}/stock-peers?symbol=${symbol}&apikey=${fmpKey}`),
    );
    let realCalls = peersResult.wasCached ? 0 : 1;
    const peersData = peersResult.data;
    const peerSymbols: string[] = Array.isArray(peersData)
      ? peersData.slice(0, 4).map((p) => p?.symbol).filter((s): s is string => Boolean(s))
      : [];
    if (!peerSymbols.length) return { peers: [], realCalls };

    // Peer quotes are day-cached like everything else, not forced fresh during market hours -
    // unlike the subject's own quote (fetchLongTermAnalysisData's critical batch below), a
    // user isn't staring at a peer's price directly; it only feeds relative valuation ratios
    // (P/E, EV/EBITDA), where a few hours of staleness doesn't meaningfully move the comparison.
    // Decided 2026-09-07: only 1 call (the subject's own quote) stays realtime.
    const [quoteResults, keyMetricsResults] = await Promise.all([
      Promise.allSettled(peerSymbols.map((sym) => fmpDailyCache.getOrFetch(
        sym, 'quote', `GET /quote?symbol=${sym}`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${fmpKey}`),
      ))),
      Promise.allSettled(peerSymbols.map((sym) => fmpDailyCache.getOrFetch(
        sym, 'key-metrics', `GET /key-metrics?symbol=${sym}`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/key-metrics?symbol=${sym}&apikey=${fmpKey}`),
      ))),
    ]);

    for (const r of quoteResults) if (r.status === 'fulfilled' && !r.value.wasCached) realCalls++;
    for (const r of keyMetricsResults) if (r.status === 'fulfilled' && !r.value.wasCached) realCalls++;

    const peers = peerSymbols.map((sym, i) => {
      const q = quoteResults[i].status === 'fulfilled' ? first<any>((quoteResults[i] as PromiseFulfilledResult<fmpDailyCache.GetOrFetchResult<any>>).value.data) : null;
      const km = keyMetricsResults[i].status === 'fulfilled' ? first<any>((keyMetricsResults[i] as PromiseFulfilledResult<fmpDailyCache.GetOrFetchResult<any>>).value.data) : null;
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
    return { peers, realCalls };
  } catch (err) {
    // Reaching here means getOrFetch's fetchFn actually ran and threw - a cache hit reads
    // straight from the DB and can never fail this way - so this was still a real (failed)
    // FMP call attempt and counts as one, same as the pre-cache formula always did.
    // Logged (2026-09-07, previously silently swallowed) - a real failure here was previously
    // completely undiagnosable, which is exactly what happened with financial-estimates below
    // before it was removed.
    console.error(`fetchPeerData failed for ${symbol}:`, err);
    return { peers: [], realCalls: 1 }; // non-critical — peer data never blocks the report
  }
}

// financial-estimates removed entirely 2026-09-07 - confirmed live to fail on every symbol
// tested (WM, NVDA - including a mega-cap that's covered on virtually any FMP plan tier),
// meaning it's a plan-level restriction on this endpoint, not a per-symbol coverage gap. It
// never once returned usable data, so forwardEpsEstimate now just stays null unconditionally -
// the exact same degraded-gracefully behavior this already had, minus the wasted call every
// single lookup was silently retrying and re-failing on.

async function fetchEvToEbitda(symbol: string, fmpKey: string): Promise<{ value: number | null; realCalls: number }> {
  try {
    const result = await fmpDailyCache.getOrFetch(
      symbol, 'key-metrics', `GET /key-metrics?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/key-metrics?symbol=${symbol}&apikey=${fmpKey}`),
    );
    const row = first<any>(result.data);
    return { value: row?.evToEBITDA ?? row?.enterpriseValueOverEBITDA ?? null, realCalls: result.wasCached ? 0 : 1 };
  } catch (err) {
    // See fetchPeerData's own catch comment - a cache hit can't reach here, so this was a
    // real (failed) attempt. Logged (2026-09-07, previously silently swallowed).
    console.error(`fetchEvToEbitda failed for ${symbol}:`, err);
    return { value: null, realCalls: 1 };
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
    fmpDailyCache.getOrFetch(symbol, 'profile', `GET /profile?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/profile?symbol=${symbol}&apikey=${fmpKey}`)),
    // quote stays live while the market is open (fmpDailyCache.isMarketOpenNow()) - folded into
    // the same day-cache once the market closes, since a closing price is final for the day.
    fmpDailyCache.getOrFetch(symbol, 'quote', `GET /quote?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${symbol}&apikey=${fmpKey}`),
      { forceFresh: fmpDailyCache.isMarketOpenNow() }),
    // limit=5, not 3 - Contrarian Comeback (Phase 2) wants 4 periods from this same cached row;
    // fetching the superset once and slicing per-consumer avoids caching per-limit variants of
    // the same underlying data. Sliced back to 3 below, unchanged output shape.
    fmpDailyCache.getOrFetch(symbol, 'income-statement', `GET /income-statement?symbol=${symbol}&period=annual&limit=5`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/income-statement?symbol=${symbol}&period=annual&limit=5&apikey=${fmpKey}`)),
    // NOT /earnings-calendar — confirmed live 2026-07-26 that endpoint ignores
    // the symbol param entirely and returns the market-wide calendar for that
    // date. /earnings is the correct per-symbol actual-vs-estimate history.
    fmpDailyCache.getOrFetch(symbol, 'earnings', `GET /earnings?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/earnings?symbol=${symbol}&apikey=${fmpKey}`)),
    fmpDailyCache.getOrFetch(symbol, 'price-target-consensus', `GET /price-target-consensus?symbol=${symbol}`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/price-target-consensus?symbol=${symbol}&apikey=${fmpKey}`)),
    // limit=50, matching Contrarian Comeback's own grades call - the cache doesn't key on
    // query params, so whichever feature ran first for a symbol would otherwise silently decide
    // the grades dataset the other one also gets. Standardized on the more inclusive value.
    fmpDailyCache.getOrFetch(symbol, 'grades', `GET /grades?symbol=${symbol}&limit=50`,
      () => fmpGet<any>(`${env.fmpBaseUrl}/grades?symbol=${symbol}&limit=50&apikey=${fmpKey}`)),
  ]);

  const rejected = critical.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (rejected) throw rejected.reason;

  const criticalResults = critical.map((r) => (r as PromiseFulfilledResult<fmpDailyCache.GetOrFetchResult<any>>).value);
  const [profileResult, quoteResult, incomeResult, surpriseResult, ptResult, gradesResult] = criticalResults;
  const profileRaw = profileResult.data;
  const quoteRaw = quoteResult.data;
  const incomeRaw = incomeResult.data;
  const surpriseRaw = surpriseResult.data;
  const ptRaw = ptResult.data;
  const gradesRaw = gradesResult.data;
  const criticalRealCalls = criticalResults.filter((r) => !r.wasCached).length;

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
  const [peerResult, evResult, news] = await Promise.all([
    fetchPeerData(symbol, fmpKey),
    fetchEvToEbitda(symbol, fmpKey),
    fetchNews(symbol, finnhubKey),
  ]);
  const peers = peerResult.peers;
  // financial-estimates removed 2026-09-07 - see the comment above fetchEvToEbitda.
  const forwardEpsEstimate = null;
  const evToEbitda = evResult.value;

  if (!profile || !quote) {
    throw new InvalidTickerError(`No data returned for ${symbol}. Check the ticker symbol or your API key.`);
  }

  const fmpCallCount = criticalRealCalls + peerResult.realCalls + evResult.realCalls;

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
    apiCallCounts: { fmp: fmpCallCount, finnhub: finnhubKey ? 1 : 0 },
  };
}
