// Pure port of the source app's js/portfolio-performance.js calcTabReturn()
// and js/portfolio.js's renderBarChart() Outlier selection - no component
// state, operates entirely on the performanceHistory record refreshPrices()
// now returns. Crypto exclusion isn't ported here - the backend already
// excludes crypto symbols from performanceHistory (see
// portfolio.service.ts's isPerfSkipped), so they simply have no entry here.

export interface PerformanceBar {
  date: string;
  close: number;
  low?: number;
}

export interface PeriodTab {
  id: string;
  label: string;
  days: number;
  useCalendar: boolean;
}

// Trading-day mode (<=15D): FMP returns only trading days, so hist[N] is
// exactly N trading days ago - direct array index, no date math. Calendar
// mode (30D+): finds the closest available trading day to now-N-days via
// nearest-date matching, since 30+ calendar days almost always span a
// weekend/holiday that trading-day indexing alone can't account for.
export const PERIOD_TABS: PeriodTab[] = [
  { id: '1D', label: '1D', days: 1, useCalendar: false },
  { id: '5D', label: '5D', days: 5, useCalendar: false },
  { id: '10D', label: '10D', days: 10, useCalendar: false },
  { id: '15D', label: '15D', days: 15, useCalendar: false },
  { id: '30D', label: '30D', days: 30, useCalendar: true },
  { id: '60D', label: '60D', days: 60, useCalendar: true },
  { id: '90D', label: '90D', days: 90, useCalendar: true },
  { id: '120D', label: '120D', days: 120, useCalendar: true },
];

export interface TabReturnResult {
  returnMap: Map<string, number>;
  startDate: string | null;
  endDate: string | null;
}

export function calcTabReturn(
  history: Record<string, PerformanceBar[]>,
  days: number,
  useCalendar: boolean,
): TabReturnResult {
  const targetMs = Date.now() - days * 86_400_000;
  const returnMap = new Map<string, number>();
  let startDate: string | null = null;
  let endDate: string | null = null;

  for (const [ticker, hist] of Object.entries(history)) {
    let startClose: number | undefined;
    let startIdx: number;
    if (!useCalendar) {
      startIdx = days;
      startClose = hist[days]?.close;
    } else {
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let j = 0; j < hist.length; j++) {
        const diff = Math.abs(new Date(hist[j].date).getTime() - targetMs);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
      }
      startIdx = bestIdx;
      startClose = hist[bestIdx]?.close;
    }
    if (!startClose) continue;
    if (!endDate && hist[0]?.date && hist[startIdx]?.date) {
      endDate = hist[0].date;
      startDate = hist[startIdx].date;
    }
    const endClose = hist[0]?.close;
    if (!endClose) continue;
    returnMap.set(ticker, ((endClose - startClose) / startClose) * 100);
  }

  return { returnMap, startDate, endDate };
}

// Custom tab: a per-run re-fetch on the backend isn't wired up (the unified
// Refresh Prices already fetches limit=130, which comfortably covers up to
// 120 days) - Custom just reuses calcTabReturn with whatever day count the
// user typed in, same as the fixed tabs above.
export function calcCustomReturn(history: Record<string, PerformanceBar[]>, days: number): TabReturnResult {
  return calcTabReturn(history, days, days > 10);
}

// Outlier = top 13 by return (advances) + top 12 by most-negative return
// (declines), sorted best -> worst across both groups. 'all' just returns
// everything sorted, no trimming.
export function applyOutlierFilter<T>(
  items: T[],
  getValue: (item: T) => number | null | undefined,
  mode: 'outlier' | 'all',
): T[] {
  const withValue = items.filter((item) => getValue(item) != null);
  const sorted = [...withValue].sort((a, b) => (getValue(b) as number) - (getValue(a) as number));
  if (mode === 'all') return sorted;
  const positives = sorted.filter((item) => (getValue(item) as number) >= 0);
  const negatives = sorted.filter((item) => (getValue(item) as number) < 0);
  return [...positives.slice(0, 13), ...negatives.slice(-12)];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> 'Mmm-DD', matching the source app's date-range display format.
export function fmtMmDd(dateStr: string): string {
  const [, mm, dd] = dateStr.split('-');
  return `${MONTHS[parseInt(mm, 10) - 1]}-${dd}`;
}
