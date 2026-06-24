// Ported from CreateStockPortfolioViewWOSkill/js/utils.js (fmpGet) and
// js/live-prices.js (fetchQuotesFMP) — refactored from browser fetch +
// localStorage key to Node's built-in fetch + backend-only env vars.
// The FMP key never leaves this module; the frontend never sees it.

const env = require('../config/env');

class MissingApiKeyError extends Error {}

// Throws on HTTP errors and FMP error-message responses.
// Use Promise.allSettled at call sites to handle partial failures gracefully.
async function fmpGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) { /* ignore */ }
    throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
  }
  const data = await res.json();
  if (data?.['Error Message']) throw new Error('KEY_INVALID: ' + data['Error Message']);
  return data;
}

function requireFmpKey() {
  if (!env.fmpApiKey) throw new MissingApiKeyError('FMP_API_KEY is not set in backend environment.');
  return env.fmpApiKey;
}

// One call per symbol, all parallel — mirrors fetchQuotesFMP's shape exactly
// so livePrices.service.js / parser.service.js consumers don't need to change.
async function getQuotes(symbols) {
  const key = requireFmpKey();
  const results = await Promise.allSettled(
    symbols.map(async (sym) => {
      const res = await fetch(`${env.fmpBaseUrl}/quote?symbol=${sym}&apikey=${key}`);
      if (res.status === 402) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${sym}`);
      const data = await res.json();
      if (!data) return null;
      if (data['Error Message']) throw new Error('KEY_INVALID');
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
  );

  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const { sym, price, changeDollar, changePercent, name } = r.value;
      if (!isNaN(price) && price > 0) map[sym] = { price, changeDollar, changePercent, name };
    }
  }

  const errors = results.filter((r) => r.status === 'rejected');
  if (errors.length && errors[0].reason?.message?.includes('KEY_INVALID')) {
    throw new Error('Invalid or expired FMP API key.');
  }
  return map;
}

// Used by momentum.service.js / contrarianFinder.service.js for historical closes.
async function getHistorical(symbol, limit = 60) {
  const key = requireFmpKey();
  const raw = await fmpGet(`${env.fmpBaseUrl}/historical-price-eod/full?symbol=${symbol}&limit=${limit}&apikey=${key}`);
  return Array.isArray(raw) ? raw : (raw?.historical ?? []);
}

module.exports = { fmpGet, getQuotes, getHistorical, requireFmpKey, MissingApiKeyError };
