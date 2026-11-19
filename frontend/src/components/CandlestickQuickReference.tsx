import { HORIZONS, INDICATOR_LABELS, type IndicatorKey } from '../lib/candlestickIndicators';

interface IndicatorRef {
  key: IndicatorKey;
  measures: string;
  bestFor: string;
  caveat: string;
}

// bestFor is deliberately still hand-written prose here (not derived from HORIZON_INDICATORS),
// since it needs to read naturally ("Day Trading only" vs. "All three") rather than a
// mechanically-joined list - but it must still describe the SAME set the Core Indicators lists
// above actually contain. Two real mismatches were caught and fixed here 2026-09-20 while wiring
// up the code-driven filtering (this table had drifted from the bulleted lists above it):
// Bollinger Bands was labeled "All three, differently" despite Long-Term's own Skip line
// explicitly naming it as skippable there; Volume MA was labeled "Medium & Long-Term" despite
// never appearing in the Medium-Term core list at all (it's Day Trading + Long-Term). Both now
// match their horizon's own bulleted list exactly.
const INDICATOR_REFERENCE: IndicatorRef[] = [
  { key: 'ma', measures: 'Trend direction & speed', bestFor: 'Medium & Long-Term', caveat: 'Too slow to react intraday, though SMA20/EMA20 can still mark a same-day bias.' },
  { key: 'bb', measures: 'Volatility & mean-reversion', bestFor: 'Day Trading & Medium-Term', caveat: 'A squeeze can appear at any horizon, but long-term reads are already covered by the trend indicators above.' },
  { key: 'vwap', measures: 'Intraday fair-value benchmark', bestFor: 'Day Trading only', caveat: 'Recalculated fresh over whatever window is displayed - not meaningful on multi-day charts.' },
  { key: 'pivotPoints', measures: 'Session support/resistance', bestFor: 'Day Trading only', caveat: 'Same single-session caveat as VWAP.' },
  { key: 'fibonacci', measures: 'Retracement / pullback levels', bestFor: 'Medium-Term, also Long-Term', caveat: 'Needs a clear prior swing high/low to mean anything.' },
  { key: 'rsi', measures: 'Overbought/oversold momentum', bestFor: 'Day & Medium-Term', caveat: 'Least useful long-term - can stay extended for months in a strong trend.' },
  { key: 'macd', measures: 'Momentum / trend-shift crossovers', bestFor: 'All three', caveat: "Read it at the timeframe you're actually trading - a 5-min crossover means nothing to a long-term holder." },
  { key: 'volumeMa', measures: 'Smoothed participation trend', bestFor: 'Day Trading & Long-Term', caveat: 'Confirms whether a price move has real backing.' },
  { key: 'obv', measures: 'Cumulative buying/selling pressure', bestFor: 'Medium & Long-Term (most valuable long-term)', caveat: "Watch for divergence from price, not the absolute level." },
];

// Static reference content (2026-09-19, renamed from "Cheat Sheet" to "Quick Reference" the same
// day for clarity - see CandlestickPopup.tsx's header) - a tab inside the Candlestick popup
// itself ("Stock Details with the Diagram"), not a new top-level app tab, per explicit direction:
// this is meant to help interpret the chart you're already looking at, not stand alone as its own
// destination. Deliberately has zero data dependency - same content regardless of
// symbol/interval/snapshot state, so CandlestickPopup renders it independently of the
// loading/fetch/snapshot branches.
export default function CandlestickQuickReference() {
  return (
    <div className="flex flex-col gap-4" data-testid="candlestick-quick-reference">
      <p className="text-xs text-text-muted">
        Which timeframe and indicators fit your trading horizon - a starting point for reading
        this chart, not financial advice. For Long-Term calls, pair this with the Long-Term
        Analysis and Contrarian Comeback tabs' fundamentals - a chart alone tells you whether the
        structure looks healthy, not whether it's a good business at a fair price.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {HORIZONS.map((h) => (
          <div key={h.id} className="rounded-card bg-bg-card p-4 shadow-card">
            <h3 className="text-sm font-semibold text-text-primary">{h.title}</h3>
            <p className="mt-0.5 text-xs text-text-secondary">{h.timeframes}</p>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-text-muted">Core Indicators</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {h.core.map((c) => (
                <li key={c.key} className="text-xs text-text-secondary">
                  <span className="font-semibold text-text-primary">{INDICATOR_LABELS[c.key]}</span> — {c.why}
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs text-text-muted">
              <span className="font-medium">Skip:</span> {h.skip}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-card bg-bg-card p-4 shadow-card">
        <h3 className="text-sm font-semibold text-text-primary">All 9 Indicators — At a Glance</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Indicator</th>
                <th className="py-1.5 pr-3 font-medium">Measures</th>
                <th className="py-1.5 pr-3 font-medium">Best For</th>
                <th className="py-1.5 font-medium">Caveat</th>
              </tr>
            </thead>
            <tbody>
              {INDICATOR_REFERENCE.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 font-semibold text-text-primary">{INDICATOR_LABELS[r.key]}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{r.measures}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{r.bestFor}</td>
                  <td className="py-1.5 text-text-secondary">{r.caveat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
