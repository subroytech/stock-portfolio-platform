import { useState, type FormEvent } from 'react';
import { useLongTermAnalysis, type ConvictionResult, type LongTermAnalysisResult } from '../api/longTermAnalysis';
import { ApiError } from '../api/client';
import { formatCurrency } from '../lib/format';
import { useIncomingTicker } from '../lib/tickerHandoff';
import { useTickerHistory } from '../lib/tickerHistory';
import StockPreviewChart from '../components/StockPreviewChart';
import TickerSubTabs from '../components/TickerSubTabs';

const RATING_STYLES: Record<string, string> = {
  bullish: 'bg-success/10 text-success',
  neutral: 'bg-warning/10 text-warning',
  bearish: 'bg-danger/10 text-danger',
};

function na(value: number | string | null | undefined): string {
  return value == null || value === '' ? '—' : String(value);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function fmtPp(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function fmt$(value: number | null | undefined): string {
  return value == null ? '—' : formatCurrency(value);
}

function fmtMultiple(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}×`;
}

function fmtCompact(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

interface ConvictionCardProps {
  horizon: string;
  result: ConvictionResult;
  maxScore: number;
}

function ConvictionCard({ horizon, result, maxScore }: ConvictionCardProps) {
  return (
    <div className={`rounded-card p-3 ${RATING_STYLES[result.rating]}`}>
      <p className="text-xs uppercase tracking-wide text-text-muted">{horizon}</p>
      <p className="mt-1 text-base font-bold">{result.rating} <span className="text-sm font-normal">({result.score}/{maxScore})</span></p>
      <p className="mt-1 text-sm text-text-secondary">{result.rationale}</p>
    </div>
  );
}

export default function LongTermAnalysisPage() {
  const [ticker, setTicker] = useState('');
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const analysis = useLongTermAnalysis();
  const history = useTickerHistory<LongTermAnalysisResult>({ storageKey: 'longTermAnalysis:history' });

  // Case 2 - switching to an already-cached sub-tab. Also clears any stale
  // error from a previous failed lookup (that mutation is otherwise never
  // re-run, so its isError would keep showing over the newly-selected tab).
  function selectExisting(symbol: string) {
    analysis.reset();
    history.select(symbol);
  }

  function runTicker(symbol: string) {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return;
    if (history.has(upper)) { selectExisting(upper); return; } // Case 2
    setPendingSymbol(upper);
    analysis.mutate(upper, {
      onSuccess: (result) => { history.insert(upper, result); setPendingSymbol(null); }, // Case 1
      onError: () => setPendingSymbol(null), // Case 3 - history untouched, error shown below
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runTicker(ticker);
  }

  useIncomingTicker('long-term-analysis', (symbol) => {
    setTicker(symbol);
    runTicker(symbol);
  });

  const data = history.active;

  return (
    <>
      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <TickerSubTabs
          symbols={history.entries.map((e) => e.symbol)}
          activeSymbol={history.activeSymbol}
          pendingSymbol={pendingSymbol}
          onSelect={selectExisting}
          onClose={history.close}
        />

        {/* Ticker entry + MT/LT conviction — kept in one card so the
            conviction summary fills the space next to the form instead of
            sitting empty until the reader scrolls all the way down. */}
        <div className="flex flex-col gap-4 rounded-card bg-bg-card p-4 shadow-card lg:flex-row lg:items-start">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 lg:flex-none">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Ticker
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="AAPL"
                className="w-32 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
              />
            </label>
            <button
              type="submit"
              disabled={analysis.isPending}
              className="rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {analysis.isPending ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>

          {data && (
            <div className="flex-1 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ConvictionCard horizon="Medium Term — 12 to 18 Months" result={data.mediumTerm} maxScore={6} />
                <ConvictionCard horizon="Long Term — 3 Years and Beyond" result={data.longTerm} maxScore={7} />
              </div>
              <p className="mt-3 text-xs text-text-muted">
                ⚠️ Conviction ratings are algorithmically derived from live data (analyst consensus, earnings growth,
                revenue trend, forward valuation). They are not financial advice.
              </p>
            </div>
          )}
        </div>

        {analysis.isError && (
          <p className="text-sm text-danger">
            {analysis.error instanceof ApiError
              ? (analysis.error.status === 404 ? 'Invalid Stock ticker' : analysis.error.message)
              : 'Analysis failed.'}
          </p>
        )}

        {data && (
          <div className="flex flex-col gap-4">
            {/* Section 1: Snapshot | Analyst Commentary | Bull Signals | Bear Signals, side by side */}
            <div className="rounded-card bg-bg-card p-4 shadow-card">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {/* Snapshot: ticker/company + stat grid */}
                <div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setPreviewSymbol(data.symbol)}
                      className="text-lg font-semibold text-text-primary hover:underline"
                    >
                      {data.symbol}
                    </button>
                    <span className="ml-2 text-sm text-text-secondary">
                      {data.companyName ?? ''}{data.exchange ? ` · ${data.exchange}` : ''}
                    </span>
                    <p className="mt-1 text-xs text-text-muted">
                      {na(data.sector)} · {na(data.industry)}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-text-muted">Price</p>
                      <p className="text-sm font-semibold text-text-primary">{fmt$(data.price)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Market Cap</p>
                      <p className="text-sm font-semibold text-text-primary">{fmtCompact(data.marketCap)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Dividend</p>
                      <p className="text-sm font-semibold text-text-primary">{data.dividend != null ? `${fmt$(data.dividend)}/yr` : 'None'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">EV/EBITDA</p>
                      <p className="text-sm font-semibold text-text-primary">{fmtMultiple(data.valuation.evToEbitda)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Trailing P/E</p>
                      <p className="text-sm font-semibold text-text-primary">{fmtMultiple(data.valuation.trailingPe)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">52w Range</p>
                      <p className="text-sm font-semibold text-text-primary">{na(data.range52w)}</p>
                    </div>
                  </div>
                </div>

                {/* Analyst Commentary & Price Targets */}
                <div className="border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <h2 className="mb-3 text-sm font-semibold text-text-primary">Analyst Commentary &amp; Price Targets</h2>
                  <div>
                    <p className="text-xs text-text-muted">12-Month Consensus Price Target</p>
                    <p className="text-xl font-bold text-accent">{fmt$(data.priceTarget?.targetConsensus)}</p>
                    {data.priceTarget?.targetLow != null && data.priceTarget?.targetHigh != null && (
                      <p className="text-xs text-text-muted">Low {fmt$(data.priceTarget.targetLow)} · High {fmt$(data.priceTarget.targetHigh)}</p>
                    )}
                    {data.upsidePct != null && (
                      <p className={`mt-1 text-sm font-semibold ${data.upsidePct >= 0 ? 'text-success' : 'text-danger'}`}>
                        {fmtPct(data.upsidePct)} {data.upsidePct >= 0 ? 'upside' : 'downside'} vs current {fmt$(data.price)}
                      </p>
                    )}
                  </div>

                  <div className="mt-4">
                    {data.consensus.totalAnalysts > 0 ? (
                      <>
                        <p className="mb-2 text-xs text-text-muted">
                          {data.consensus.buyPct}% Buy / {data.consensus.holdPct}% Hold / {data.consensus.sellPct}% Sell ({data.consensus.totalAnalysts} analysts)
                        </p>
                        <div className="flex h-2.5 overflow-hidden rounded-full bg-border">
                          <div className="bg-success" style={{ width: `${data.consensus.buyPct}%` }} />
                          <div className="bg-warning" style={{ width: `${data.consensus.holdPct}%` }} />
                          <div className="bg-danger" style={{ width: `${data.consensus.sellPct}%` }} />
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-text-muted">Analyst consensus data not available.</p>
                    )}
                  </div>
                </div>

                {/* Bull Signals */}
                <div className="border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">Bull Signals</h3>
                  <ul className="list-inside list-disc text-sm text-text-secondary">
                    {data.bullSignals.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>

                {/* Bear Signals */}
                <div className="border-t border-border pt-4 sm:border-l sm:pl-4 xl:border-t-0 xl:pt-0">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">Bear Signals</h3>
                  <ul className="list-inside list-disc text-sm text-text-secondary">
                    {data.bearSignals.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              </div>
            </div>

            {/* Section 2: Annual Financials | EPS Surprises | Peer Comparison, side by side */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Annual Financials</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-text-muted">
                        <th className="pb-2">Metric</th>
                        <th className="pb-2 text-right">{data.financials.fyLabel}</th>
                        <th className="pb-2 text-right">{data.financials.fyPrevLabel}</th>
                        <th className="pb-2 text-right">YoY</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-secondary">
                      <tr className="border-t border-border">
                        <td className="py-2">Revenue</td>
                        <td className="py-2 text-right">{fmtCompact(data.financials.revenue.current)}</td>
                        <td className="py-2 text-right">{fmtCompact(data.financials.revenue.prior)}</td>
                        <td className={`py-2 text-right ${(data.financials.revenue.yoyPct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>{fmtPct(data.financials.revenue.yoyPct)}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="py-2">Gross Margin</td>
                        <td className="py-2 text-right">{data.financials.grossMargin.current != null ? `${data.financials.grossMargin.current.toFixed(1)}%` : '—'}</td>
                        <td className="py-2 text-right">{data.financials.grossMargin.prior != null ? `${data.financials.grossMargin.prior.toFixed(1)}%` : '—'}</td>
                        <td className={`py-2 text-right ${(data.financials.grossMargin.deltaPp ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>{fmtPp(data.financials.grossMargin.deltaPp)}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="py-2">Operating Margin</td>
                        <td className="py-2 text-right">{data.financials.operatingMargin.current != null ? `${data.financials.operatingMargin.current.toFixed(1)}%` : '—'}</td>
                        <td className="py-2 text-right">{data.financials.operatingMargin.prior != null ? `${data.financials.operatingMargin.prior.toFixed(1)}%` : '—'}</td>
                        <td className={`py-2 text-right ${(data.financials.operatingMargin.deltaPp ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>{fmtPp(data.financials.operatingMargin.deltaPp)}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="py-2">EPS (diluted)</td>
                        <td className="py-2 text-right">{data.financials.eps.current != null ? fmt$(data.financials.eps.current) : '—'}</td>
                        <td className="py-2 text-right">{data.financials.eps.prior != null ? fmt$(data.financials.eps.prior) : '—'}</td>
                        <td className={`py-2 text-right ${(data.financials.eps.yoyPct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>{fmtPct(data.financials.eps.yoyPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">EPS Surprises — Last 4 Quarters</h2>
                {data.earningsSurprises.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-text-muted">
                          <th className="pb-2">Quarter End</th>
                          <th className="pb-2 text-right">Actual</th>
                          <th className="pb-2 text-right">Estimated</th>
                          <th className="pb-2 text-right">Surprise</th>
                        </tr>
                      </thead>
                      <tbody className="text-text-secondary">
                        {data.earningsSurprises.map((s) => {
                          const beat = s.epsActual != null && s.epsEstimated != null ? s.epsActual >= s.epsEstimated : null;
                          const surprisePct = s.epsActual != null && s.epsEstimated != null && s.epsEstimated !== 0
                            ? ((s.epsActual - s.epsEstimated) / Math.abs(s.epsEstimated)) * 100
                            : null;
                          return (
                            <tr key={s.date} className="border-t border-border">
                              <td className="py-2">{na(s.date)}</td>
                              <td className={`py-2 text-right ${beat === true ? 'text-success' : beat === false ? 'text-danger' : ''}`}>{s.epsActual != null ? fmt$(s.epsActual) : '—'}</td>
                              <td className="py-2 text-right">{s.epsEstimated != null ? fmt$(s.epsEstimated) : '—'}</td>
                              <td className={`py-2 text-right ${beat === true ? 'text-success' : beat === false ? 'text-danger' : ''}`}>{fmtPct(surprisePct)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">No earnings surprise data available.</p>
                )}
              </div>

              <div className="rounded-card bg-bg-card p-4 shadow-card md:col-span-2 lg:col-span-1">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Industry &amp; Peer Comparison</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-text-muted">
                        <th className="pb-2">Company</th>
                        <th className="pb-2 text-right">Price</th>
                        <th className="pb-2 text-right">P/E</th>
                        <th className="pb-2 text-right">EV/EBITDA</th>
                        <th className="pb-2 text-right">Mkt Cap</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-secondary">
                      <tr className="border-t border-border bg-accent/5 font-semibold text-text-primary">
                        <td className="py-2">{data.symbol} ★</td>
                        <td className="py-2 text-right">{fmt$(data.price)}</td>
                        <td className="py-2 text-right">{fmtMultiple(data.valuation.trailingPe)}</td>
                        <td className="py-2 text-right">{fmtMultiple(data.valuation.evToEbitda)}</td>
                        <td className="py-2 text-right">{fmtCompact(data.marketCap)}</td>
                      </tr>
                      {data.peers.map((p) => (
                        <tr key={p.symbol} className="border-t border-border">
                          <td className="py-2">{p.symbol}</td>
                          <td className="py-2 text-right">{fmt$(p.price)}</td>
                          <td className="py-2 text-right">{fmtMultiple(p.trailingPe)}</td>
                          <td className="py-2 text-right">{fmtMultiple(p.evToEbitda)}</td>
                          <td className="py-2 text-right">{fmtCompact(p.marketCap)}</td>
                        </tr>
                      ))}
                      {data.valuation.peerCount > 0 && (
                        <tr className="border-t border-border italic text-text-muted">
                          <td className="py-2">Peer Avg (approx.)</td>
                          <td className="py-2 text-right">—</td>
                          <td className="py-2 text-right">{fmtMultiple(data.valuation.peerAvgTrailingPe)}</td>
                          <td className="py-2 text-right">{fmtMultiple(data.valuation.peerAvgEvToEbitda)}</td>
                          <td className="py-2 text-right">—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-text-muted">{data.peerNote}</p>
              </div>
            </div>

            {/* Section 3: Recent News — flush with Section 2's 3-column structure */}
            {data.news.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-text-primary">Recent News</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {data.news.map((n, i) => (
                    <div key={`${n.url ?? n.title}-${i}`} className="rounded-card bg-bg-card p-4 shadow-card">
                      <p className="text-xs text-text-muted">{na(n.date)}{n.source ? ` · ${n.source}` : ''}</p>
                      <p className="text-sm text-text-primary">
                        {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{n.title}</a> : n.title}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </>
  );
}
