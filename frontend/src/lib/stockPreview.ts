// Pure, testable port of CreateStockPortfolioViewWOSkill/js/stock-preview-chart.js's
// computeReturns() and the chart-data-prep block (lines 110-141) — the only
// non-trivial client-side logic for the Stock Preview widget; everything
// else (the FMP calls) now lives server-side (backend/src/controllers
// /stockPreview.controller.ts). `data` is newest-first, matching the
// backend's `historical` response field.

export interface HistoricalBar {
  date: string;
  close: number | string;
  [key: string]: unknown;
}

export interface PeriodReturns {
  today: number | null;
  prev: number | null;
  d5: number | null;
  d10: number | null;
  d15: number | null;
  d30: number | null;
  d60: number | null;
  d90: number | null;
}

export function computeReturns(data: HistoricalBar[], currentPx: number, marketOpen: boolean): PeriodReturns {
  const get = (idx: number): number | null => {
    const v = data[idx]?.close;
    return v == null ? null : parseFloat(String(v));
  };
  const pct = (end: number | null, start: number | null): number | null => (
    start ? ((end ?? 0) - start) / start * 100 : null
  );

  if (marketOpen) {
    return {
      today: pct(currentPx, get(0)),
      prev: pct(currentPx, get(1)),
      d5: pct(currentPx, get(5)),
      d10: pct(currentPx, get(10)),
      d15: pct(currentPx, get(15)),
      d30: pct(currentPx, get(30)),
      d60: pct(currentPx, get(60)),
      d90: pct(currentPx, get(90)),
    };
  }
  return {
    today: pct(get(0), get(1)),
    prev: pct(get(0), get(2)),
    d5: pct(get(0), get(6)),
    d10: pct(get(0), get(11)),
    d15: pct(get(0), get(16)),
    d30: pct(get(0), get(31)),
    d60: pct(get(0), get(61)),
    d90: pct(get(0), get(91)),
  };
}

export interface ChartSeries {
  labels: string[];
  chartPrices: number[];
  pctSeries: number[];
  rawDates: string[];
}

export function buildChartSeries(data: HistoricalBar[], currentPx: number, marketOpen: boolean): ChartSeries {
  // Build price series — 90 trading days oldest-first (data is newest-first).
  const rawPrices = data.slice(0, 90).reverse();
  const chartPrices = rawPrices.map((d) => parseFloat(String(d.close)));
  const rawDates = rawPrices.map((d) => d.date.slice(5));

  if (marketOpen) {
    chartPrices.push(currentPx);
    rawDates.push('Live');
  }

  const pctSeries = chartPrices.map((p) => (p > 0 ? (currentPx - p) / p * 100 : 0));

  function calDayIdx(calDays: number): number {
    const targetMs = Date.now() - calDays * 864e5;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < rawPrices.length; i++) {
      const diff = Math.abs(new Date(rawPrices[i].date).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  const n = chartPrices.length - 1;
  const labels = Array(chartPrices.length).fill('');
  for (const [calDays, lbl] of [[120, '120D'], [90, '90D'], [60, '60D'], [30, '30D']] as const) {
    const idx = calDayIdx(calDays);
    if (idx >= 0 && idx < n - 1) labels[idx] = lbl;
  }
  if (n >= 1) labels[n - 1] = 'Prev';
  labels[n] = marketOpen ? 'O' : 'C';

  return { labels, chartPrices, pctSeries, rawDates };
}
