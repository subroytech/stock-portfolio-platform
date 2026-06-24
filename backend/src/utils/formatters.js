// Ported from CreateStockPortfolioViewWOSkill/js/utils.js — pure, no DOM dependency.

const fmt$ = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const fmtB = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  return v.toLocaleString();
};

const fmtPct = (v, d = 1) => (v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%');

const fmtX = (v) => (v == null ? '—' : Number(v).toFixed(1) + '×');

const fmtNum = (n) => (n == null || isNaN(n) ? '—' : new Intl.NumberFormat('en-US').format(n));

const parseNum = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,%]/g, ''));
  return isNaN(n) ? null : n;
};

module.exports = { fmt$, fmtB, fmtPct, fmtX, fmtNum, parseNum };
