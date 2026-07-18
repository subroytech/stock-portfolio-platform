import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMomentumAnalysis } from '../api/momentum';
import { ApiError } from '../api/client';
import { calcKellySizing } from '../lib/kelly';
import { formatCurrency, formatNumber, formatPercent } from '../lib/format';

const SIGNAL_STYLES: Record<string, string> = {
  'STRONG BUY': 'bg-success/10 text-success',
  BUY: 'bg-success/10 text-success',
  WATCH: 'bg-warning/10 text-warning',
  AVOID: 'bg-danger/10 text-danger',
};

function readStoredCapital(): number {
  try {
    return parseFloat(localStorage.getItem('momentum-capital') ?? '') || 50000;
  } catch {
    return 50000;
  }
}

export default function MomentumPage() {
  const [ticker, setTicker] = useState('');
  const [capital, setCapital] = useState(readStoredCapital);
  const analysis = useMomentumAnalysis();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    analysis.mutate(ticker.trim().toUpperCase());
  }

  function handleCapitalChange(value: number) {
    setCapital(value);
    try { localStorage.setItem('momentum-capital', String(value)); } catch { /* ignore */ }
  }

  const data = analysis.data?.analysis;
  const kelly = data ? calcKellySizing(data.rr, capital, data.entryMid, data.score.total) : null;

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-4 shadow-card sm:px-6">
        <h1 className="text-lg font-semibold text-text-primary">Momentum Analysis</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Back to dashboard</Link>
      </header>

      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-card bg-bg-card p-4 shadow-card">
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

        {analysis.isError && (
          <p className="text-sm text-danger">
            {analysis.error instanceof ApiError ? analysis.error.message : 'Analysis failed.'}
          </p>
        )}

        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-card bg-bg-card p-4 shadow-card">
              <span className="text-lg font-semibold text-text-primary">
                {analysis.data!.symbol}{analysis.data!.name ? ` · ${analysis.data!.name}` : ''}
              </span>
              <span className={`rounded-btn px-3 py-1 text-sm font-semibold ${SIGNAL_STYLES[data.signal]}`}>
                {data.signal}
              </span>
              <span className="text-sm text-text-secondary">Score {data.score.total}/10</span>
              <span className="ml-auto text-lg font-semibold text-text-primary">{formatCurrency(data.price)}</span>
            </div>

            <div className="rounded-card bg-bg-card p-4 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">Score Breakdown</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  ['RSI', data.score.rsi],
                  ['MACD', data.score.macd],
                  ['Volume', data.score.volume],
                  ['Trend', data.score.trend],
                  ['R:R', data.score.riskReward],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex flex-col items-center gap-1">
                    <span className="text-xs text-text-secondary">{label}</span>
                    <span className={`text-lg font-semibold ${value >= 2 ? 'text-success' : value === 1 ? 'text-warning' : 'text-text-muted'}`}>
                      {value}/2
                    </span>
                    <div className="h-1.5 w-full rounded-full bg-bg-primary">
                      <div
                        className={`h-1.5 rounded-full ${value >= 2 ? 'bg-success' : value === 1 ? 'bg-warning' : 'bg-text-muted'}`}
                        style={{ width: `${(value / 2) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Indicators</h2>
                <dl className="grid grid-cols-2 gap-y-1 text-sm text-text-secondary">
                  <div className="flex justify-between pr-2"><dt>RSI (14)</dt><dd className="text-text-primary">{data.rsi.toFixed(1)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>SMA 20</dt><dd className="text-text-primary">{formatCurrency(data.sma20)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>SMA 50</dt><dd className="text-text-primary">{formatCurrency(data.sma50)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>MACD Hist</dt><dd className="text-text-primary">{data.macd.hist.toFixed(3)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>BB Upper</dt><dd className="text-text-primary">{formatCurrency(data.bb.upper)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>BB Lower</dt><dd className="text-text-primary">{formatCurrency(data.bb.lower)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>Vol Ratio</dt><dd className="text-text-primary">{data.volRatio.toFixed(2)}x</dd></div>
                  <div className="flex justify-between pr-2"><dt>Day Chg</dt><dd className="text-text-primary">{formatCurrency(data.dayChg)}</dd></div>
                </dl>
              </div>

              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-text-primary">Trade Setup</h2>
                <dl className="grid grid-cols-2 gap-y-1 text-sm text-text-secondary">
                  <div className="flex justify-between pr-2"><dt>Entry</dt><dd className="text-text-primary">{formatCurrency(data.entryLow)}–{formatCurrency(data.entryHigh)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>Stop Loss</dt><dd className="text-danger">{formatCurrency(data.stopLoss)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>Target</dt><dd className="text-success">{formatCurrency(data.target)}</dd></div>
                  <div className="flex justify-between pr-2"><dt>R:R</dt><dd className="text-text-primary">{data.rr.toFixed(2)}</dd></div>
                </dl>

                <div className="mt-4 border-t border-border pt-3">
                  <label className="flex flex-col gap-1 text-sm text-text-secondary">
                    Capital
                    <input
                      type="number"
                      min={0}
                      value={capital}
                      onChange={(e) => handleCapitalChange(Number(e.target.value))}
                      className="w-32 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
                    />
                  </label>
                  {kelly && (
                    kelly.noEntry ? (
                      <p className="mt-2 text-sm text-text-muted">No entry — score below 6.</p>
                    ) : (
                      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm text-text-secondary">
                        <div className="flex justify-between pr-2"><dt>Half-Kelly</dt><dd className="text-text-primary">{formatPercent(kelly.hk * 100)}</dd></div>
                        <div className="flex justify-between pr-2"><dt>Position</dt><dd className="text-text-primary">{formatCurrency(kelly.pos)}</dd></div>
                        <div className="flex justify-between pr-2"><dt>Shares</dt><dd className="text-text-primary">{formatNumber(kelly.sh)}</dd></div>
                      </dl>
                    )
                  )}
                </div>
              </div>
            </div>

            {(data.flags.length > 0 || data.extras.length > 0) && (
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-2 text-sm font-semibold text-text-primary">Signals &amp; Warnings</h2>
                <ul className="list-inside list-disc text-sm text-text-secondary">
                  {[...data.flags, ...data.extras].map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
