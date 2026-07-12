// Ported from CreateStockPortfolioViewWOSkill/js/utils.js — pure, no DOM dependency.

type Num = number | null | undefined;

export const fmt$ = (v: Num): string => (v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const fmtB = (v: Num): string => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  return v.toLocaleString();
};

export const fmtPct = (v: Num, d = 1): string => (v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%');

export const fmtX = (v: Num): string => (v == null ? '—' : Number(v).toFixed(1) + '×');

export const fmtNum = (n: Num): string => (n == null || isNaN(n) ? '—' : new Intl.NumberFormat('en-US').format(n));

export const parseNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,%]/g, ''));
  return isNaN(n) ? null : n;
};
