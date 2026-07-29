export function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function gainLossColorClass(value: number): string {
  return value >= 0 ? 'text-success' : 'text-danger';
}

export function formatCompactCurrency(value: number): string {
  return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
}

// Ported from the source app's 4-tier decline severity scale (index.html's
// .cf-chg-15/20/25/35 classes, contrarian-finder.js's chgCls ternary) —
// mapped onto this app's warning/danger tokens (no dedicated "orange" token
// exists here) with escalating font-weight standing in for the source's
// escalating red intensity.
export function contrarianSeverityClass(changePct: number): string {
  if (changePct <= -35) return 'text-danger font-extrabold';
  if (changePct <= -25) return 'text-danger font-bold';
  if (changePct <= -20) return 'text-danger font-semibold';
  return 'text-warning font-semibold';
}
