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

// Full (non-abbreviated) dollar amount, rounded to the nearest whole dollar -
// for totals where "$1.2K" is too imprecise but cents aren't meaningful.
export function formatWholeCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

// Shared by DashboardPage's staleness banner and both charts' Today's-$
// "as of" captions - all three read the same DB-persisted priceUpdatedAt.
export function formatAsOf(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Date only, no time of day - the Transaction History table's own Date column only needs the
// day an import happened, and dropping the time (vs. formatAsOf above) is what actually lets
// that column fit inside the table's narrower width.
export function formatDateOnly(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

// "3 days and 7 hours ago" - a plain elapsed-time readout computed once at render time (no
// live-ticking interval), same precedent as formatAsOf above never re-rendering on its own.
export function formatElapsedSince(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  if (diffMs < 0) return 'just now';
  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0 && hours === 0) return 'less than an hour ago';
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  return `${parts.join(' and ')} ago`;
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
