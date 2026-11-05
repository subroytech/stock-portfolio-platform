// Ported from CreateStockPortfolioViewWOSkill/js/utils.js (fmpGet) and
// js/live-prices.js (fetchQuotesFMP) — refactored from browser fetch +
// localStorage key to Node's built-in fetch + backend-only env vars.
// The FMP key never leaves this module; the frontend never sees it.
//
// getQuotes()/getHistorical() take the FMP key as an explicit parameter
// (2026-07-12) rather than reading a global env.fmpApiKey internally —
// callers resolve the calling user's own key via
// userSubscription.service.ts's getDecryptedKey() first. The old
// requireFmpKey()/MissingApiKeyError were removed once that left them with
// zero callers.

import env from '../config/env';
import * as fmpDailyCache from './fmpDailyCache.service';

export interface FmpGetOptions {
  timeoutMs?: number;
}

// Single shared fetch wrapper for every FMP call in this service.
// - Aborts after timeoutMs (default 20s) so a hung request can't block a request.
// - HTTP 402 (plan-tier restriction) resolves to null - treated as "no data", not an error.
// - 401/403/429 and any other non-OK status, plus an FMP { "Error Message": ... } body, throw.
// Use Promise.allSettled at call sites to handle partial failures gracefully.
export async function fmpGet<T = any>(url: string, { timeoutMs = 20000 }: FmpGetOptions = {}): Promise<T | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 402) return null;
    if (res.status === 401 || res.status === 403) throw new Error('Invalid or expired FMP API key.');
    if (res.status === 429) throw new Error('FMP rate limit reached. Please wait a moment before retrying.');
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) { /* ignore */ }
      throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
    }
    const data = await res.json();
    if ((data as { 'Error Message'?: string })?.['Error Message']) throw new Error('Invalid or expired FMP API key.');
    return data as T;
  } finally {
    clearTimeout(tid);
  }
}

export interface Quote {
  price: number;
  changeDollar: number;
  changePercent: number;
  name: string;
  // Only consumed by stockPreview.controller.ts today (deciding whether the
  // chart's rightmost point is a live intraday price or the last close) —
  // present here since every other Quote consumer just ignores it.
  isActivelyTrading: boolean;
}

export interface QuotesResult {
  quotes: Record<string, Quote>;
  // How many of these symbols were real FMP calls, not served from the shared daily cache -
  // feeds every caller's usageTracking.logUsage() so the Usage Audit reflects actual cost, not
  // just "how many symbols were requested" (see fmpDailyCache.service.ts's own header comment).
  realCalls: number;
}

// One call per symbol, all parallel, routed through the shared daily cache
// (fmpDailyCache.service.ts, built for Long-Term Analysis/Contrarian Comeback) - a quote stays
// live while the US market is open (forceFresh) and folds into the day-cache once it closes,
// since a closing price is final for the day. Symbol-keyed and shared across every caller of
// this function (Refresh Prices, Momentum, Stock Preview, GET /quotes) - the same 'quote' cache
// entries Long-Term Analysis/Contrarian Comeback already populate, so any of these six features
// looking up a symbol the same day after market close benefits from whichever one asked first.
export async function getQuotes(symbols: string[], apiKey: string): Promise<QuotesResult> {
  const results = await Promise.allSettled(
    symbols.map((sym) =>
      fmpDailyCache.getOrFetch(
        sym, 'quote', `GET /quote?symbol=${sym}`,
        () => fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${apiKey}`, { timeoutMs: 15000 }),
        { forceFresh: fmpDailyCache.isMarketOpenNow() },
      ).then((cacheResult) => {
        const data = cacheResult.data;
        if (!data) return { sym, quote: null, wasCached: cacheResult.wasCached };
        const q = Array.isArray(data) ? data[0] : data;
        if (!q || !q.price) return { sym, quote: null, wasCached: cacheResult.wasCached };
        const livePx = parseFloat(q.price);
        const chgDol = parseFloat(q.change ?? q.priceChange) || 0;
        const prevPx = livePx - chgDol;
        const chgPct = prevPx > 0.01
          ? (chgDol / prevPx) * 100
          : parseFloat(q.changesPercentage ?? q.changePercent) || 0;
        return {
          sym, wasCached: cacheResult.wasCached,
          quote: {
            price: livePx, changeDollar: chgDol, changePercent: chgPct, name: q.name || '',
            isActivelyTrading: q.isActivelyTrading === true,
          },
        };
      })
    )
  );

  const map: Record<string, Quote> = {};
  let realCalls = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (!r.value.wasCached) realCalls++;
      const { sym, quote } = r.value;
      if (quote && !isNaN(quote.price) && quote.price > 0) map[sym] = quote;
    }
  }

  // A cache hit can never reach a rejection - getOrFetch only calls fetchFn (which is what can
  // throw) on a miss - so every rejected symbol here was a genuine, real attempted call.
  const errors = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  realCalls += errors.length;
  if (errors.length && errors[0].reason?.message?.includes('Invalid or expired FMP API key')) {
    throw new Error('Invalid or expired FMP API key. Please update your key.');
  }
  return { quotes: map, realCalls };
}

export interface TickerProfile {
  name: string;
  sector: string;
  marketCap: number | null;
}

// One call per symbol via FMP's /profile endpoint, same one-call-per-symbol
// parallel shape as getQuotes above - used to backfill m_tickers.name/sector/
// market_cap (see backend/src/db/backfillTickerData.ts and
// contrarianFinder.service.ts's refreshTickerDataBatch()). /profile carries
// all three fields in one response (companyName + sector + marketCap),
// unlike /quote which has marketCap/name but never sector reliably
// (confirmed live 2026-07-27 - see contrarianFinder.service.ts's
// fetchSectorMap comment). Using /profile uniformly for all three keeps a
// single consistent source rather than mixing quote- and profile-sourced
// fields.
export async function getProfiles(symbols: string[], apiKey: string): Promise<Record<string, TickerProfile>> {
  const results = await Promise.allSettled(
    symbols.map((sym) =>
      fmpGet<any>(`${env.fmpBaseUrl}/profile?symbol=${sym}&apikey=${apiKey}`, { timeoutMs: 15000 }).then((data) => {
        if (!data) return null;
        const p = Array.isArray(data) ? data[0] : data;
        if (!p) return null;
        return { sym, name: p.companyName || '', sector: p.sector || '', marketCap: p.marketCap ?? null };
      })
    )
  );

  const map: Record<string, TickerProfile> = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value && (r.value.name || r.value.sector || r.value.marketCap != null)) {
      const { sym, name, sector, marketCap } = r.value;
      map[sym] = { name, sector, marketCap };
    }
  }

  const errors = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (errors.length && errors[0].reason?.message?.includes('Invalid or expired FMP API key')) {
    throw new Error('Invalid or expired FMP API key. Please update your key.');
  }
  return map;
}

export interface HistoricalBar {
  date?: string;
  close: number | string;
  low?: number | string;
  [key: string]: unknown;
}

export interface HistoricalResult {
  bars: HistoricalBar[];
  // 1 if this was a real FMP call, 0 if served from the shared daily cache - see QuotesResult
  // above for why callers need this rather than just "was a symbol requested."
  realCalls: number;
}

// contrarianComebackData.service.ts already caches this same FMP endpoint under the identical
// (symbol, 'historical-price-eod') cache key at this exact limit, for its own subject-symbol
// deep-history analysis - always fetching this larger, shared limit here too (regardless of the
// caller's own smaller `limit` below) means every caller ends up reading/writing the SAME cache
// entry per symbol, rather than one caller's smaller request silently overwriting what another
// caller needed (the exact bug already found+fixed once for `grades`'s limit param). FMP returns
// bars newest-first, so slicing the first N is "the most recent N," matching what a native
// limit=N request would have returned - this costs a bigger response body on a cache miss, never
// an extra real FMP call.
const HISTORICAL_CACHE_LIMIT = 1000;

export async function getHistorical(symbol: string, apiKey: string, limit = 60): Promise<HistoricalResult> {
  const cacheResult = await fmpDailyCache.getOrFetch(
    symbol, 'historical-price-eod', `GET /historical-price-eod/full?symbol=${symbol}&limit=${HISTORICAL_CACHE_LIMIT}`,
    () => fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${symbol}&limit=${HISTORICAL_CACHE_LIMIT}&apikey=${apiKey}`),
  );
  const raw = cacheResult.data;
  const bars: HistoricalBar[] = Array.isArray(raw) ? raw : (raw?.historical ?? []);
  return { bars: bars.slice(0, limit), realCalls: cacheResult.wasCached ? 0 : 1 };
}
