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
}

// One call per symbol, all parallel — mirrors fetchQuotesFMP's shape exactly
// so livePrices.service.ts / parser.service.ts consumers don't need to change.
export async function getQuotes(symbols: string[], apiKey: string): Promise<Record<string, Quote>> {
  const results = await Promise.allSettled(
    symbols.map((sym) =>
      fmpGet<any>(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${apiKey}`, { timeoutMs: 15000 }).then((data) => {
        if (!data) return null;
        const q = Array.isArray(data) ? data[0] : data;
        if (!q || !q.price) return null;
        const livePx = parseFloat(q.price);
        const chgDol = parseFloat(q.change ?? q.priceChange) || 0;
        const prevPx = livePx - chgDol;
        const chgPct = prevPx > 0.01
          ? (chgDol / prevPx) * 100
          : parseFloat(q.changesPercentage ?? q.changePercent) || 0;
        return { sym, price: livePx, changeDollar: chgDol, changePercent: chgPct, name: q.name || '' };
      })
    )
  );

  const map: Record<string, Quote> = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const { sym, price, changeDollar, changePercent, name } = r.value;
      if (!isNaN(price) && price > 0) map[sym] = { price, changeDollar, changePercent, name };
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

// Not currently called anywhere in src/ — contrarianFinder.service.ts builds
// its own historical-price-eod fmpGet call inline rather than using this.
// Kept for momentum-analysis work that hasn't landed yet; apiKey is explicit
// (not read from env) for the same reason as getQuotes above.
export async function getHistorical(symbol: string, apiKey: string, limit = 60): Promise<HistoricalBar[]> {
  const raw = await fmpGet<any>(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${symbol}&limit=${limit}&apikey=${apiKey}`);
  return Array.isArray(raw) ? raw : (raw?.historical ?? []);
}
