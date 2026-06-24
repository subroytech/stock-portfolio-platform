// Ported from CreateStockPortfolioViewWOSkill/js/portfolio.js
// (mapHeaders, parseGenericCsv, isRobinhoodTxt, parseRobinhoodTxt, parseFile) —
// pure parsing logic, no DOM/localStorage dependency in the original, so this
// is a near-direct copy. Papa.parse browser global -> require('papaparse').
//
// Note: allocation% is intentionally NOT computed here, matching the original
// split (parseGenericCsv/parseRobinhoodTxt never set it either — loadData()
// computed it afterwards from the full holdings set). The /portfolios
// controller does that once Track B exists.

const Papa = require('papaparse');
const { parseNum } = require('../utils/formatters');
const { HEADER_ALIASES } = require('../db/seed/header_aliases');
const { EMPOWER_SECTOR_MAP } = require('../db/seed/empower_sector_map');
const { TICKER_SECTORS } = require('../db/seed/ticker_sectors');

function mapHeaders(headers) {
  const norm = headers.map((h) => h.toLowerCase().trim().replace(/[_-]/g, ' '));
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const i = norm.indexOf(alias);
      if (i !== -1) { map[field] = i; break; }
    }
  }
  return map;
}

function parseGenericCsv(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (!result.data.length) throw new Error('CSV appears to be empty or could not be parsed.');

  const headers = result.meta.fields;
  const map = mapHeaders(headers);

  const hasPurchasePrice = 'purchasePrice' in map;
  const hasMarketValue = 'marketValue' in map;
  const hasGainLoss = 'gainLossDollar' in map;
  const missing = ['symbol', 'quantity', 'currentPrice'].filter((f) => !(f in map));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}. Headers found: ${headers.join(', ')}`);

  const data = [];
  const errors = [];
  let cashTotal = 0;

  // handles "(123.45)" as -123.45 — Pending Activity can be net negative
  function parseCashAmt(v) {
    if (v == null) return null;
    let s = String(v).trim();
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    const n = parseNum(s);
    return n == null ? null : (neg ? -Math.abs(n) : n);
  }

  result.data.forEach((row, i) => {
    const vals = Object.values(row);
    const sym = vals[map.symbol] ? String(vals[map.symbol]).trim().toUpperCase() : null;
    const qty = parseNum(vals[map.quantity]);
    const cp = parseNum(vals[map.currentPrice]);
    const nameVal = map.name !== undefined ? String(vals[map.name] || '').trim().toUpperCase() : '';

    // Cash-like rows (Empower placeholders, Fidelity sweep fund / Pending Activity) —
    // redirect their dollar value into cashTotal instead of discarding them.
    const isCashRow = (sym && (sym === 'USD999997' || sym === 'DIDA' || sym.includes('**')))
      || nameVal.includes('PENDING ACTIVITY')
      || sym === 'PENDING ACTIVITY';
    if (isCashRow) {
      const amt = hasMarketValue ? parseCashAmt(vals[map.marketValue])
        : (qty != null && cp != null ? qty * cp : null);
      if (amt != null) cashTotal += amt;
      return;
    }

    if (!sym) return;
    if (!qty || qty <= 0) { errors.push(`Row ${i + 2}: Invalid quantity (${sym})`); return; }
    if (!cp || cp <= 0) { errors.push(`Row ${i + 2}: Invalid current price (${sym})`); return; }

    let pp = hasPurchasePrice ? parseNum(vals[map.purchasePrice]) : null;
    if ((!pp || pp <= 0) && hasMarketValue && hasGainLoss) {
      const mv = parseNum(vals[map.marketValue]);
      const gl = parseNum(vals[map.gainLossDollar]);
      if (mv != null && gl != null && qty > 0) pp = (mv - gl) / qty;
    }
    if (!pp || pp <= 0) pp = cp;

    const rawSector = map.sector !== undefined ? String(vals[map.sector] || '').trim() : '';
    const normSector = rawSector.toLowerCase();
    const mappedSector = EMPOWER_SECTOR_MAP[normSector] || rawSector || 'Unknown';
    const finalSector = (mappedSector === 'Unknown' || mappedSector === 'Equities')
      ? (TICKER_SECTORS[sym] || mappedSector)
      : mappedSector;

    const entry = {
      symbol: sym,
      name: map.name !== undefined ? (String(vals[map.name] || '').trim() || sym) : sym,
      quantity: qty,
      purchasePrice: pp,
      currentPrice: cp,
      sector: finalSector,
      purchaseDate: map.purchaseDate !== undefined ? String(vals[map.purchaseDate] || '').trim() : '',
    };
    entry.costBasis = qty * pp;
    entry.currentValue = qty * cp;
    entry.gainLoss = entry.currentValue - entry.costBasis;
    entry.returnPct = pp > 0 ? ((cp - pp) / pp) * 100 : 0;
    data.push(entry);
  });

  if (!data.length) throw new Error('No valid rows found. ' + (errors[0] || ''));
  return { data, errors, cashAmount: cashTotal };
}

function isRobinhoodTxt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const sig = ['Name', 'Symbol', 'Shares', 'Price', 'Average cost', 'Total return', 'Equity'];
  for (let i = 0; i <= Math.min(lines.length - 7, 15); i++) {
    if (sig.every((h, j) => lines[i + j] === h)) return true;
  }
  return false;
}

function parseRobinhoodTxt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const data = [];
  const errors = [];

  const STOCK_HDR = ['Name', 'Symbol', 'Shares', 'Price', 'Average cost', 'Total return', 'Equity'];
  const CRYPTO_HDR = ['Name', 'Symbol', 'Quantity', 'Price', 'Average cost', 'Total return', 'Equity'];

  function findSectionStart(fromIdx, headers) {
    for (let i = fromIdx; i <= lines.length - 7; i++) {
      if (headers.every((h, j) => lines[i + j] === h)) return i + 7;
    }
    return -1;
  }

  function parseGroup(pos, isCrypto) {
    if (pos + 6 >= lines.length) return null;
    const name = lines[pos];
    const sym = lines[pos + 1].toUpperCase();
    const qty = parseNum(lines[pos + 2]);
    const cp = parseNum(lines[pos + 3]);
    const pp = parseNum(lines[pos + 4]);
    // lines[pos + 5] = Total return — ignored: sign is stripped in Robinhood exports
    const equity = parseNum(lines[pos + 6]);

    if (!sym || !qty || qty <= 0 || !cp || cp <= 0) return null;
    const purchasePrice = (pp && pp > 0) ? pp : cp;
    const currentValue = (equity && equity > 0) ? equity : qty * cp;
    const costBasis = qty * purchasePrice;

    return {
      symbol: sym,
      name,
      quantity: qty,
      purchasePrice,
      currentPrice: cp,
      sector: isCrypto ? 'Crypto' : (TICKER_SECTORS[sym] || 'Unknown'),
      purchaseDate: '',
      costBasis,
      currentValue,
      gainLoss: currentValue - costBasis,
      returnPct: purchasePrice > 0 ? ((cp - purchasePrice) / purchasePrice) * 100 : 0,
    };
  }

  let pos = findSectionStart(0, STOCK_HDR);
  if (pos === -1) throw new Error('Could not locate Robinhood stock header block.');

  while (pos < lines.length) {
    if (lines[pos].startsWith('Stocks & options')) { pos++; break; }
    if (lines[pos] === 'Crypto') break;
    const entry = parseGroup(pos, false);
    if (entry) data.push(entry);
    else errors.push(`Skipped unreadable group near: "${lines[pos]}"`);
    pos += 7;
  }

  const cryptoStart = findSectionStart(pos, CRYPTO_HDR);
  if (cryptoStart !== -1) {
    pos = cryptoStart;
    while (pos + 6 < lines.length) {
      const entry = parseGroup(pos, true);
      if (entry) data.push(entry);
      else errors.push(`Skipped unreadable crypto group near: "${lines[pos]}"`);
      pos += 7;
    }
  }

  if (!data.length) throw new Error('No valid holdings found in Robinhood file.');
  return { data, errors, cashAmount: 0 };
}

function parseFile(text) {
  if (isRobinhoodTxt(text)) return parseRobinhoodTxt(text);
  return parseGenericCsv(text);
}

module.exports = { mapHeaders, parseGenericCsv, isRobinhoodTxt, parseRobinhoodTxt, parseFile };
