import type { PortfolioHolding } from '../api/portfolios';
import type { PerformanceBar } from './performanceMath';

// Top-6 Sectors views (Allocation + Performance). Pure helpers only - the charts themselves
// live in components/TopSectorBars.tsx.

export const TOP_SECTOR_COUNT = 6;
// Trailing windows in trading days (2026-11-15: 60/90/120 added). Cached history holds 130 trading days
// per symbol, so 120 is the longest window that's always covered.
export const TRAILING_WINDOWS = [1, 5, 10, 15, 30, 60, 90, 120] as const;

export interface SectorGroup {
  sector: string;
  holdings: PortfolioHolding[];
  totalValue: number;
}

// Ranks sectors by total current value and keeps the largest `count`. A holding with no sector
// falls back to its own symbol, matching the existing "By Sector" pie in AllocationChart.
// Holdings inside each sector are sorted by value, largest first.
export function getTopSectors(holdings: PortfolioHolding[], count = TOP_SECTOR_COUNT): SectorGroup[] {
  const groups = new Map<string, PortfolioHolding[]>();
  for (const h of holdings) {
    const key = h.sector || h.symbol;
    const list = groups.get(key);
    if (list) list.push(h);
    else groups.set(key, [h]);
  }
  return [...groups.entries()]
    .map(([sector, hs]) => ({
      sector,
      holdings: [...hs].sort((a, b) => b.currentValue - a.currentValue),
      totalValue: hs.reduce((sum, h) => sum + h.currentValue, 0),
    }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, count);
}

// US regular session: Mon-Fri, 9:30am-4:00pm America/New_York. No holiday calendar, same as the
// backend's isMarketOpenNow(), so a market holiday reads as "open" here too.
export function isMarketOpenEastern(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = part('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = parseInt(part('hour'), 10) * 60 + parseInt(part('minute'), 10);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export interface TrailingChange {
  dollar: number;
  percent: number;
  // quantity x start price - the base the percent change is measured against, so a sector's
  // aggregate percent can be computed as (sum of $ changes) / (sum of start values).
  startValue: number;
}

// Change over the trailing `days` trading days for one holding.
//   Market closed: end = last close (hist[0]), start = hist[days] - the same indexing
//   calcTabReturn already uses for its 1D-15D tabs.
//   Market open:   end = the holding's current price (as of the last Refresh Prices), start =
//   hist[days - 1], so the 1-day window is today vs. the previous close.
// dollar = quantity x (end - start). Returns null when there isn't enough history or the
// symbol has no history at all (e.g. crypto, which the backend excludes).
export function calcTrailingChange(
  holding: PortfolioHolding,
  hist: PerformanceBar[] | undefined,
  days: number,
  marketOpen: boolean,
): TrailingChange | null {
  if (!hist || hist.length === 0) return null;
  const startClose = hist[marketOpen ? days - 1 : days]?.close;
  const endClose = marketOpen ? holding.currentPrice : hist[0]?.close;
  if (!startClose || !endClose) return null;
  return {
    dollar: holding.quantity * (endClose - startClose),
    percent: ((endClose - startClose) / startClose) * 100,
    startValue: holding.quantity * startClose,
  };
}

// Sector total shown in a chart header, e.g. 168338 -> "$168.3K", 500 -> "$0.5K".
export function fmtSectorTotal(v: number): string {
  return `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1000).toFixed(1)}K`;
}

// Signed sector change for the Performance header: +12345 -> "+$12.3K", -4500 -> "-$4.5K".
export function fmtSignedDollarK(v: number): string {
  return `${v >= 0 ? '+' : '-'}$${(Math.abs(v) / 1000).toFixed(1)}K`;
}

// Signed sector percent change: 1.234 -> "+1.23%", -0.5 -> "-0.50%".
export function fmtSignedPercent(v: number): string {
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}%`;
}

// Axis label for dollar values: 1000 -> "$1k", 2500 -> "$2.5k", 500 -> "$500", -10000 -> "-$10k".
export function fmtDollarTick(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${Number((abs / 1000).toFixed(1))}k`;
  return `${sign}$${Math.round(abs)}`;
}
