import '../lib/chartSetup';
import { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import type { PortfolioHolding, RefreshPricesResult } from '../api/portfolios';
import { applyOutlierFilter, calcCustomReturn, calcTabReturn, fmtMmDd, PERIOD_TABS } from '../lib/performanceMath';
import { formatAsOf } from '../lib/format';

interface PerformanceChartProps {
  holdings: PortfolioHolding[];
  refreshResult?: RefreshPricesResult;
}

// Bright floral tones (matching AllocationChart's palette) - vivid leaf
// green vs. vivid poppy red, still clearly gain vs. loss but punchier than
// the flat Tailwind green/red defaults.
const GAIN_COLOR = '#2ECC71';
const LOSS_COLOR = '#E63950';

// Oldest priceUpdatedAt across whichever holdings actually contributed a
// today_change value - same "don't overclaim freshness" principle as
// DashboardPage's portfolio-wide staleness banner, but scoped to just the
// holdings this specific view is built from.
function oldestAsOf(holdings: { priceUpdatedAt: string | null }[]): string | null {
  return holdings.map((h) => h.priceUpdatedAt).filter((t): t is string => t != null).sort()[0] ?? null;
}

// Per-holding gain/loss bar chart. Before ANY data exists (never refreshed,
// ever), falls back to the only thing derivable without it (total $ gain/
// loss since purchase) - once either todayChangeDollar (DB-persisted,
// migration 014) or refreshResult (this session's Refresh Prices click)
// exists, unlocks the richer view. The Today ($) tab reads todayChangeDollar
// straight off `holdings`, so it's available immediately on load/portfolio
// switch, independent of refreshResult - the 1D-120D/Custom tabs still need
// refreshResult.performanceHistory (not DB-persisted; session-only) and show
// a "click Refresh Prices" prompt in their place when it's absent.
export default function PerformanceChart({ holdings, refreshResult }: PerformanceChartProps) {
  const hasTodayData = holdings.some((h) => h.todayChangeDollar != null);
  const [activeTab, setActiveTab] = useState<string>(refreshResult || !hasTodayData ? '1D' : 'TodayDollar');
  const [barMode, setBarMode] = useState<'outlier' | 'all'>('outlier');
  const [customDays, setCustomDays] = useState(30);

  if (holdings.length === 0) {
    return <p className="text-sm text-text-secondary">No holdings to chart yet.</p>;
  }

  if (!refreshResult && !hasTodayData) {
    const sorted = [...holdings].sort((a, b) => b.gainLoss - a.gainLoss);
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="min-h-0 flex-1">
          <Bar
            data={{
              labels: sorted.map((h) => h.symbol),
              datasets: [{
                label: 'Gain / Loss ($)',
                data: sorted.map((h) => h.gainLoss),
                backgroundColor: sorted.map((h) => (h.gainLoss >= 0 ? GAIN_COLOR : LOSS_COLOR)),
              }],
            }}
            options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
          />
        </div>
        <p className="shrink-0 text-xs text-text-muted">
          Click <strong>Refresh Prices</strong> above for period returns (1D-120D), an Outlier view, and a Today&rsquo;s $ mode.
        </p>
      </div>
    );
  }

  const isDollar = activeTab === 'TodayDollar';
  let values: { symbol: string; value: number | null }[];
  let title: string;
  let dateRange: { start: string; end: string } | null = null;
  let needsHistory = false;

  if (activeTab === 'TodayDollar') {
    title = "Today's $ Gain/Loss";
    values = holdings.map((h) => ({ symbol: h.symbol, value: h.todayChangeDollar }));
  } else if (!refreshResult) {
    needsHistory = true;
    title = '';
    values = [];
  } else if (activeTab === 'Custom') {
    const { returnMap, startDate, endDate } = calcCustomReturn(refreshResult.performanceHistory, customDays);
    title = `Performance — Last ${customDays} ${customDays > 10 ? 'calendar' : 'trading'} day${customDays === 1 ? '' : 's'}`;
    if (startDate && endDate) dateRange = { start: startDate, end: endDate };
    values = holdings.map((h) => ({ symbol: h.symbol, value: returnMap.get(h.symbol) ?? null }));
  } else {
    const tab = PERIOD_TABS.find((t) => t.id === activeTab) ?? PERIOD_TABS[0];
    const { returnMap, startDate, endDate } = calcTabReturn(refreshResult.performanceHistory, tab.days, tab.useCalendar);
    title = `Performance — Last ${tab.days} ${tab.useCalendar ? 'calendar' : 'trading'} day${tab.days === 1 ? '' : 's'}`;
    if (startDate && endDate) dateRange = { start: startDate, end: endDate };
    values = holdings.map((h) => ({ symbol: h.symbol, value: returnMap.get(h.symbol) ?? null }));
  }

  const filtered = applyOutlierFilter(values, (v) => v.value, barMode);
  const todayAsOf = activeTab === 'TodayDollar' ? oldestAsOf(holdings.filter((h) => h.todayChangeDollar != null)) : null;

  const tabButtonClass = (id: string) => `rounded-btn px-2 py-1 text-xs font-medium transition-colors ${
    activeTab === id ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-border'
  }`;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {PERIOD_TABS.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={tabButtonClass(tab.id)}>
              {tab.label}
            </button>
          ))}
          <button type="button" onClick={() => setActiveTab('Custom')} className={tabButtonClass('Custom')}>Custom</button>
          <button type="button" onClick={() => setActiveTab('TodayDollar')} className={tabButtonClass('TodayDollar')}>Today ($)</button>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setBarMode('outlier')}
            className={`rounded-btn px-2 py-1 text-xs font-medium ${barMode === 'outlier' ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-border'}`}
          >
            Outlier
          </button>
          <button
            type="button"
            onClick={() => setBarMode('all')}
            className={`rounded-btn px-2 py-1 text-xs font-medium ${barMode === 'all' ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-border'}`}
          >
            All
          </button>
        </div>
      </div>

      {activeTab === 'Custom' && (
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">
          Days
          <input
            type="number"
            min={1}
            max={365}
            value={customDays}
            onChange={(e) => setCustomDays(Number(e.target.value))}
            className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-text-primary"
          />
          <span>{customDays > 10 ? 'calendar days' : 'trading days'}</span>
        </label>
      )}

      {dateRange && (
        <p className="shrink-0 text-xs text-text-muted">
          From <strong>{fmtMmDd(dateRange.start)}</strong> (close) to <strong>{fmtMmDd(dateRange.end)}</strong> (close)
        </p>
      )}

      {todayAsOf && <p className="shrink-0 text-xs text-text-muted">As of {formatAsOf(todayAsOf)}</p>}

      <div className="min-h-0 flex-1">
        {needsHistory ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-secondary">
              Click <strong>Refresh Prices</strong> above to fetch period history for this tab.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-secondary">No data available for this period.</p>
          </div>
        ) : (
          <Bar
            key={`${activeTab}-${barMode}-${customDays}`}
            data={{
              labels: filtered.map((v) => v.symbol),
              datasets: [{
                label: title,
                data: filtered.map((v) => v.value as number),
                backgroundColor: filtered.map((v) => ((v.value as number) >= 0 ? GAIN_COLOR : LOSS_COLOR)),
              }],
            }}
            options={{
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => ` ${isDollar ? `$${(ctx.raw as number).toFixed(2)}` : `${(ctx.raw as number).toFixed(1)}%`}` } },
              },
              scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => (isDollar ? `$${v}` : `${v}%`) } },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
