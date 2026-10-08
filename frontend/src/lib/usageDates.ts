// Shared by UsageAuditPage.tsx (Monthly list sub-tab) and UsageDashboardCards.tsx (Dashboard
// sub-tab's per-card month pickers) - both need the same "current month" default and the same
// human-readable month label.
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7) + '-01';
}

export function formatMonthLabel(month: string): string {
  return new Date(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
