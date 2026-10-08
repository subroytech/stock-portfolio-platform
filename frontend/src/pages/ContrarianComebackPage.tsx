import { useState, type FormEvent } from 'react';
import { useApiKeysModal } from '../lib/apiKeysModal';
import { useIncomingTicker } from '../lib/tickerHandoff';
import { useTickerHistory } from '../lib/tickerHistory';
import TickerSubTabs from '../components/TickerSubTabs';
import {
  useContrarianComebackGate,
  useContrarianComebackSubmit,
  type ContrarianComebackGateResult,
  type ContrarianComebackSubmitResult,
  type FundamentalHealth,
  type FundamentalMetric,
  type CatalystPipeline,
  type StagedEntry,
  type RecoveryTargets,
  type ValueDislocation,
  type ScoreBreakdown,
  type InsiderTrade,
} from '../api/contrarianComeback';
import { ApiError } from '../api/client';
import StockPreviewChart from '../components/StockPreviewChart';
import { formatCompactCurrency } from '../lib/format';

const BREAKDOWN_TYPES: { value: string; label: string; desc: string; tier: 'green' | 'yellow' | 'red' }[] = [
  { value: 'event', label: 'Event-Driven', tier: 'green', desc: 'CEO crisis, regulatory probe, PR shock, cyberattack, one-off miss' },
  { value: 'corporate', label: 'Failed Corporate Action', tier: 'green', desc: 'Blocked M&A, withdrawn acquisition, deal termination overhang' },
  { value: 'cyclical', label: 'Cyclical', tier: 'yellow', desc: 'Sector-wide downturn affecting all peers similarly' },
  { value: 'guidance', label: 'Guidance Reset', tier: 'yellow', desc: 'Guidance cut but core business model remains intact' },
  { value: 'structural', label: 'Structural', tier: 'red', desc: 'Moat eroding, secular decline, active disruption underway' },
  { value: 'valuation', label: 'Valuation Reset', tier: 'red', desc: 'Multiple compression on high-growth stock; business healthy' },
  { value: 'fraud', label: 'Fraud / Governance', tier: 'red', desc: 'Accounting irregularities, criminal leadership, regulatory seizure' },
];

const OVERRIDE_REASONS = [
  { value: 'macro', label: 'Macro-driven dip — sector down due to rate/macro shock, not fundamentals' },
  { value: 'etf_drag', label: 'ETF composition drag — one or two large holdings pulling the index' },
  { value: 'decoupled', label: 'Company decoupled — breakdown cause is independent of sector direction' },
  { value: 'own_research', label: 'Own research — I have sector data that contradicts the ETF signal' },
];

const RED_TYPES = ['structural', 'valuation', 'fraud'];

const TIER_CLASSES: Record<string, string> = {
  green: 'border-success/40 hover:bg-success/5',
  yellow: 'border-warning/40 hover:bg-warning/5',
  red: 'border-danger/40 hover:bg-danger/5',
};

const VERDICT_STYLES: Record<string, string> = {
  HIGH: 'bg-success/10 text-success',
  MODERATE: 'bg-warning/10 text-warning',
  SPECULATIVE: 'bg-warning/10 text-warning',
  AVOID: 'bg-danger/10 text-danger',
};

// Solid (non-tinted) variant of the same verdict tiers, for the Contra Score
// badge - dark green for a strong score fading to red for a weak one, same
// success/warning/danger tokens VERDICT_STYLES uses so the two stay in sync.
const SCORE_BADGE_STYLES: Record<string, string> = {
  HIGH: 'bg-success text-white',
  MODERATE: 'bg-warning text-white',
  SPECULATIVE: 'bg-warning text-white',
  AVOID: 'bg-danger text-white',
};

const TIER_PILL_STYLES: Record<string, string> = {
  green: 'bg-success/10 text-success',
  yellow: 'bg-warning/10 text-warning',
  red: 'bg-danger/10 text-danger',
};

const VALUE_TRAP_ITEMS: { key: string; name: string; desc: string }[] = [
  { key: 'guidance', name: 'Serial guidance-cutter', desc: 'Management missed guidance 3+ consecutive quarters' },
  { key: 'mkt', name: 'Shrinking addressable market', desc: 'Industry in secular decline (legacy hardware, print, etc.)' },
  { key: 'disruption', name: 'Disruption underway', desc: 'A competitor is actively taking share right now' },
  { key: 'buybacks', name: 'Debt-funded buybacks', desc: 'Borrowed heavily to repurchase stock at peak; balance sheet now impaired' },
  { key: 'accounting', name: 'Accounting complexity', desc: 'Revenue recognition changes, frequent one-time items, auditor notes' },
  { key: 'ceo', name: 'Founder/CEO departure', desc: 'Key-person risk — abrupt or acrimonious departure without clear succession' },
  { key: 'customer', name: 'Customer concentration', desc: 'Top 1–2 customers >30% of revenue with any sign of churn' },
];

function fmtPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function fmt$(value: number | null | undefined): string {
  return value == null ? '—' : `$${value.toFixed(2)}`;
}

interface RejectionCardProps {
  failedCheck: string | null;
  reason: string | null;
  route: string | null;
}

function RejectionCard({ failedCheck, reason, route }: RejectionCardProps) {
  return (
    <div className="rounded-card border border-danger/40 bg-bg-card p-6 text-center shadow-card">
      <p className="text-2xl">❌</p>
      <h2 className="mt-2 text-lg font-semibold text-text-primary">No Contrarian Opportunity Detected</h2>
      <p className="mt-1 text-sm text-text-secondary">
        This analysis will not proceed to staged entry or recovery targets.
      </p>
      <div className="mx-auto mt-4 max-w-lg rounded-btn bg-bg-primary p-4 text-left text-sm">
        <p><span className="font-semibold">Gate Failed:</span> {failedCheck}</p>
        <p className="mt-2"><span className="font-semibold">Reason:</span> {reason}</p>
      </div>
      {route && <p className="mt-3 text-xs text-text-muted">Where this belongs instead: {route}</p>}
    </div>
  );
}

interface GateFormProps {
  gate: ContrarianComebackGateResult;
  breakdownTypes: string[];
  onToggleBreakdownType: (value: string) => void;
  catalystAnswer: 'yes' | 'no' | '';
  onCatalystAnswer: (value: 'yes' | 'no') => void;
  check3Override: boolean;
  onCheck3Override: (value: boolean) => void;
  check3OverrideReason: string;
  onCheck3OverrideReason: (value: string) => void;
  onConfirm: (e: FormEvent) => void;
  isPending: boolean;
}

function GateForm({
  gate, breakdownTypes, onToggleBreakdownType, catalystAnswer, onCatalystAnswer,
  check3Override, onCheck3Override, check3OverrideReason, onCheck3OverrideReason, onConfirm, isPending,
}: GateFormProps) {
  const hasRed = breakdownTypes.some((t) => RED_TYPES.includes(t));
  const needsOverride = gate.check3Status === 'override_available';
  const canSubmit = breakdownTypes.length > 0 && catalystAnswer !== '' && (!needsOverride || (check3Override && check3OverrideReason !== ''));

  return (
    <form onSubmit={onConfirm} className="flex flex-col gap-4 rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Hard Gate — Contrarian Opportunity Screen</h2>

      <div className="flex flex-col gap-2 text-sm">
        <p className="rounded-btn bg-success/10 px-3 py-2 text-success">
          ✅ Check 1 — Drawdown: <strong>{fmtPct(-gate.drawdownPct)}</strong> (52W: {fmtPct(-gate.dd52w)} | 4Y: {fmtPct(-gate.dd4y)})
        </p>
        <p className={`rounded-btn px-3 py-2 ${needsOverride ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
          {needsOverride ? '⚠️' : '✅'} Check 3 — Sector ({gate.etfSymbol ?? 'not mapped'}): {gate.etfReturn6M != null ? `${fmtPct(gate.etfReturn6M)} over 6 months` : 'no ETF data — proceeding with caution'}
        </p>
        <p className="rounded-btn bg-success/10 px-3 py-2 text-success">✅ Check 4 — Viability confirmed</p>
      </div>

      <div className="rounded-btn bg-bg-primary p-3 text-xs text-text-secondary">
        <p className="mb-1 font-semibold uppercase tracking-wide text-text-muted">Auto-detected signals</p>
        <p>Insider activity (90d): <strong>{gate.insiderSignal}</strong> — {gate.insiderBuys} purchase(s), {gate.insiderSells} sale(s)</p>
        <p>Analyst activity (90d): <strong>{gate.analystUpgrades90d} upgrade(s)</strong>, {gate.analystDowngrades90d} downgrade(s)</p>
        {gate.priceTargetAvg != null && (
          <p>Consensus target: <strong>{fmt$(gate.priceTargetAvg)}</strong> — implied upside <strong>{fmtPct(gate.analystUpsidePct)}</strong></p>
        )}
        {gate.recentNews.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            {gate.recentNews.map((n, i) => (
              <p key={`${n.title}-${i}`} className="py-0.5">
                <span className="text-text-muted">{n.date ?? ''}</span> {n.title}
              </p>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">Check 2 — Breakdown Type <span className="font-normal text-text-muted">(select all that apply)</span></p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BREAKDOWN_TYPES.map((t) => (
            <label key={t.value} className={`flex cursor-pointer items-start gap-2 rounded-btn border p-2 text-sm ${TIER_CLASSES[t.tier]}`}>
              <input
                type="checkbox"
                checked={breakdownTypes.includes(t.value)}
                onChange={() => onToggleBreakdownType(t.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-text-primary">{t.label}</span>
                <span className="block text-xs text-text-muted">{t.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {hasRed && (
          <p className="mt-2 rounded-btn bg-danger/10 p-2 text-xs text-danger">
            ⚠️ A red type confirms the decline is not temporary — this will produce a rejection.
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">Check 5 — Recovery Catalyst Exists?</p>
        <div className="flex gap-3">
          <label className={`flex flex-1 items-center gap-2 rounded-btn border px-3 py-2 text-sm ${catalystAnswer === 'yes' ? 'border-accent bg-accent/5' : 'border-border'}`}>
            <input type="radio" name="catalystAnswer" checked={catalystAnswer === 'yes'} onChange={() => onCatalystAnswer('yes')} />
            Yes — at least one identifiable catalyst
          </label>
          <label className={`flex flex-1 items-center gap-2 rounded-btn border px-3 py-2 text-sm ${catalystAnswer === 'no' ? 'border-accent bg-accent/5' : 'border-border'}`}>
            <input type="radio" name="catalystAnswer" checked={catalystAnswer === 'no'} onChange={() => onCatalystAnswer('no')} />
            No — no visible recovery path
          </label>
        </div>
      </div>

      {needsOverride && (
        <div className="rounded-btn border border-warning/40 bg-warning/5 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <input type="checkbox" checked={check3Override} onChange={(e) => onCheck3Override(e.target.checked)} />
            Override sector check — I understand the risk and have a reason to continue
          </label>
          {check3Override && (
            <div className="mt-2">
              <select
                value={check3OverrideReason}
                onChange={(e) => onCheck3OverrideReason(e.target.value)}
                className="w-full rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="">— Select override reason —</option>
                {OVERRIDE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p className="mt-2 text-xs text-warning">
                ⚠ Override activates a degraded path: sector score forced to 0/2, total score capped at 6/10, verdict ceiling is MODERATE.
              </p>
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || isPending}
        className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {isPending ? 'Analyzing…' : 'Confirm & Run Full Analysis →'}
      </button>
    </form>
  );
}

function metricDisplay(metric: FundamentalMetric, format: (v: number) => string): string {
  return metric.value == null ? '—' : format(metric.value);
}

function FundamentalHealthCard({ health }: { health: FundamentalHealth }) {
  const rows: { label: string; metric: FundamentalMetric; display: string }[] = [
    { label: 'Debt-to-Equity', metric: health.debtToEquity, display: metricDisplay(health.debtToEquity, (v) => `${v.toFixed(1)}×`) },
    { label: 'Current Ratio', metric: health.currentRatio, display: metricDisplay(health.currentRatio, (v) => `${v.toFixed(1)}×`) },
    { label: 'Free Cash Flow', metric: health.freeCashFlow, display: metricDisplay(health.freeCashFlow, formatCompactCurrency) },
    { label: 'Revenue Growth (YoY)', metric: health.revenueGrowthPct, display: metricDisplay(health.revenueGrowthPct, (v) => fmtPct(v)) },
    { label: 'Gross Margin', metric: health.grossMarginPct, display: metricDisplay(health.grossMarginPct, (v) => `${v.toFixed(1)}%`) },
    {
      label: 'Cash Runway',
      metric: health.cashRunwayMonths,
      display: health.positiveFcf ? 'Positive FCF' : metricDisplay(health.cashRunwayMonths, (v) => `${v.toFixed(0)} months`),
    },
  ];

  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Fundamental Health</h2>
      <div className="flex flex-col divide-y divide-border">
        {rows.map((r) => {
          // Cash Runway shows "Positive FCF" (green) instead of the null runway-months tier when FCF>0.
          const tier = r.label === 'Cash Runway' && health.positiveFcf ? 'green' : r.metric.tier;
          return (
            <div key={r.label} className="flex items-center justify-between py-2 text-sm">
              <span className="text-text-secondary">{r.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text-primary">{r.display}</span>
                {tier && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_PILL_STYLES[tier]}`}>{tier}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Which side of the insider-buying signal a trade falls on - mirrors the
// exact classification analyze_insiders() uses server-side (see plan), so
// the highlighted rows visually match the aggregate signal shown above them.
function insiderTone(t: InsiderTrade): 'buy' | 'sell' | 'neutral' {
  const tp = (t.transactionType ?? '').toLowerCase();
  const ad = (t.acquisitionOrDisposition ?? '').toUpperCase();
  if (tp.includes('purchase') || ad === 'A') return 'buy';
  if (tp.includes('sale') || ad === 'D') return 'sell';
  return 'neutral';
}

// SEC Form 4 Table I transaction codes, as FMP passes them through
// ("{code}-{label}", e.g. "M-Exempt", "F-InKind") - one line per code so the
// tooltip explains only the specific code on that row, not the full list.
const INSIDER_TYPE_CODES: Record<string, string> = {
  P: 'Open-market purchase - the insider bought shares with their own money, a genuine bullish signal.',
  S: 'Open-market sale - the insider sold shares, which can be routine (e.g. diversification) or bearish depending on size/context.',
  A: 'Award/grant - new shares granted by the company (e.g. RSU vesting), not a market transaction and not a buy/sell signal.',
  D: 'Disposition back to the issuer - shares returned to the company, not an open-market trade.',
  F: 'Shares withheld "in kind" to cover taxes or an option\'s exercise cost - a routine administrative transaction, not a buy/sell decision.',
  M: 'Exercise of a previously granted option/derivative - converts an existing grant into shares, often followed by an immediate sale; not a fresh open-market purchase.',
  G: 'Bona fide gift of securities - a transfer, not a market transaction.',
  C: 'Conversion of a derivative security into common stock - not an open-market trade.',
};

function insiderTypeTooltip(transactionType: string | null): string {
  if (!transactionType) return 'SEC Form 4 transaction code.';
  const code = transactionType.split('-')[0]?.trim().toUpperCase();
  return INSIDER_TYPE_CODES[code] ?? `SEC Form 4 transaction code "${transactionType}".`;
}

function CatalystPipelineCard({ pipeline }: { pipeline: CatalystPipeline }) {
  const [showAllNews, setShowAllNews] = useState(false);
  const visibleNews = showAllNews ? pipeline.news : pipeline.news.slice(0, 5);

  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Catalyst Pipeline</h2>

      {/* Summary tying this card back to the actual catalyst score - the
          aggregate signal/count used to compute it, not just raw rows. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-btn bg-bg-primary px-3 py-2 text-sm">
        <span className="text-text-secondary">Insider signal:</span>
        <span className={`font-semibold ${pipeline.insiderSignal === 'Net Buying' ? 'text-success' : pipeline.insiderSignal === 'Net Selling' ? 'text-danger' : 'text-text-secondary'}`}>
          {pipeline.insiderSignal}
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-secondary">{pipeline.analystUpgrades90d} analyst upgrade(s) (90d)</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Recent News</p>
          {visibleNews.length > 0 ? (
            <div className="flex flex-col gap-2">
              {visibleNews.map((n, i) => (
                <div key={`${n.title}-${i}`} className="border-b border-border pb-2 text-sm last:border-b-0">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-text-primary hover:text-accent hover:underline">{n.title}</a>
                  ) : (
                    <span className="text-text-primary">{n.title}</span>
                  )}
                  <p className="text-xs text-text-muted">{n.date ?? ''} {n.source ? `· ${n.source}` : ''}</p>
                </div>
              ))}
              {pipeline.news.length > 5 && (
                <button type="button" onClick={() => setShowAllNews((v) => !v)} className="self-start text-xs text-accent hover:underline">
                  {showAllNews ? 'Show less ▲' : `Show ${pipeline.news.length - 5} more headlines ▼`}
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No recent news.</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Insider Activity (90d)</p>
          {pipeline.recentInsiderTrades.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="pb-1">Date</th><th className="pb-1">Name</th><th className="pb-1">Type</th><th className="pb-1 text-right">Shares</th>
                </tr>
              </thead>
              <tbody className="text-text-secondary">
                {pipeline.recentInsiderTrades.map((t, i) => {
                  const tone = insiderTone(t);
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1">{t.transactionDate ?? '—'}</td>
                      <td className="py-1">{t.reportingName ?? '—'}</td>
                      <td
                        className={`py-1 cursor-help font-medium underline decoration-dotted ${tone === 'buy' ? 'text-success' : tone === 'sell' ? 'text-danger' : ''}`}
                        title={insiderTypeTooltip(t.transactionType)}
                      >
                        {t.transactionType ?? '—'}
                      </td>
                      <td className="py-1 text-right">{t.securitiesTransacted != null ? t.securitiesTransacted.toLocaleString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-text-muted">No insider transactions in the last 90 days.</p>
          )}

          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Analyst Activity (90d)</p>
          {pipeline.recentGrades.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="pb-1">Date</th><th className="pb-1">Firm</th><th className="pb-1">Action</th><th className="pb-1">Rating</th>
                </tr>
              </thead>
              <tbody className="text-text-secondary">
                {pipeline.recentGrades.map((g, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1">{g.date ?? '—'}</td>
                    <td className="py-1">{g.gradingCompany ?? '—'}</td>
                    <td className={`py-1 font-medium ${g.action === 'upgrade' ? 'text-success' : g.action === 'downgrade' ? 'text-danger' : ''}`}>{g.action ?? '—'}</td>
                    <td className="py-1">{g.newGrade ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-text-muted">No analyst activity in the last 90 days.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Pure client-side checklist - never sent to the backend, has zero effect on
// gate/score/verdict (confirmed against the source app's vtUpdate(), which
// only ever touches local DOM state). Reset on every new analysis via the
// `key={result.symbol}` on ResultCard in the parent.
function ValueTrapChecklist() {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Value Trap Check</h2>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${checked.size >= 2 ? 'border-danger/40 bg-danger/10 text-danger' : 'border-border bg-bg-primary text-text-muted'}`}>
          {checked.size} of {VALUE_TRAP_ITEMS.length}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {VALUE_TRAP_ITEMS.map((item) => (
          <label key={item.key} className="flex cursor-pointer items-start gap-2 py-2 text-sm">
            <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggle(item.key)} className="mt-0.5" />
            <span>
              <span className="block font-medium text-text-primary">{item.name}</span>
              <span className="block text-xs text-text-muted">{item.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {checked.size >= 2 && (
        <p className="mt-3 rounded-btn bg-danger/10 p-2 text-xs text-danger">
          ⚠️ Value trap threshold met — 2+ structural red flags present. Exercise extreme caution before entering.
        </p>
      )}
    </div>
  );
}

const TRANCHE_BADGE_STYLES: Record<string, string> = {
  T1: 'bg-success/10 text-success',
  T2: 'bg-accent/10 text-accent',
  T3: 'bg-purple-500/10 text-purple-600',
};

const INVALIDATION_ITEMS = (etfSymbol: string | null): string[] => [
  'Criminal charges filed against company or leadership (vs. ongoing probe)',
  'Accelerating revenue decline — two or more consecutive quarters worsening',
  'Core business unit divested under duress (forced, not strategic)',
  'Credit rating downgraded to junk — signals cash flow stress beyond temporary',
  `Sector ETF (${etfSymbol ?? 'N/A'}) breaks into sustained downtrend — key tailwind removed`,
  '18 months post-entry with no recovery evidence — thesis timeline expired',
];

function StagedEntryCard({ stagedEntry }: { stagedEntry: StagedEntry }) {
  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Staged Entry Plan</h2>
      <div className="flex flex-col divide-y divide-border">
        {stagedEntry.tranches.map((t) => (
          <div key={t.label} className="flex items-start gap-3 py-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TRANCHE_BADGE_STYLES[t.label] ?? 'bg-border text-text-secondary'}`}>
              {t.label} — {t.sizePct}%
            </span>
            <div className="flex-1 text-sm">
              <p className="font-semibold text-text-primary">{fmt$(t.priceLow)} – {fmt$(t.priceHigh)}</p>
              <p className="text-xs text-text-muted">{t.trigger}</p>
            </div>
          </div>
        ))}
        <div className="flex items-start gap-3 py-2">
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">STOP</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-danger">{fmt$(stagedEntry.hardStop)}</p>
            <p className="text-xs text-text-muted">-15% from Tranche 1 midpoint — hard stop, no exceptions</p>
          </div>
        </div>
      </div>
      {stagedEntry.isMidCap && (
        <p className="mt-3 rounded-btn bg-warning/10 p-2 text-xs text-warning">
          ⚠️ {stagedEntry.capLabel} note: Check average daily dollar volume before sizing each tranche. Limit tranche size to ≤10% of avg daily volume to avoid liquidity impact.
        </p>
      )}
    </div>
  );
}

function RecoveryTargetsCard({ targets }: { targets: RecoveryTargets }) {
  const rows = [targets.conservative, targets.baseCase, targets.bullCase];
  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Recovery Targets</h2>
      <div className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between py-2 text-sm">
            <div>
              <p className="font-medium text-text-primary">{r.label} ({r.horizon})</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-text-primary">{fmt$(r.price)}</p>
              <p className="text-xs text-success">{fmtPct(r.returnPct)}</p>
            </div>
          </div>
        ))}
        {targets.analystConsensus && (
          <div className="flex items-center justify-between py-2 text-sm">
            <div>
              <p className="font-medium text-text-primary">Analyst Consensus</p>
              <p className="text-xs text-text-muted">Range: {fmt$(targets.analystConsensus.low)} – {fmt$(targets.analystConsensus.high)}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-text-primary">{fmt$(targets.analystConsensus.average)}</p>
              <p className="text-xs text-accent">{fmtPct(targets.analystConsensus.returnPct)}</p>
            </div>
          </div>
        )}
      </div>
      {targets.riskRewardRatio != null && (
        <div className="mt-3 flex items-center justify-between border-t-2 border-border pt-3">
          <span className="text-sm font-semibold text-text-primary">R:R Ratio (Base Case)</span>
          <span className="text-base font-bold text-text-primary">{targets.riskRewardRatio.toFixed(1)} : 1</span>
        </div>
      )}
    </div>
  );
}

// Pure client-side, static list - confirmed against the source's caInvalidation
// section, which has no checkboxes/scoring impact, just item 5's ETF symbol
// substituted in. No backend fields needed beyond etfSymbol, already on `result`.
function InvalidationChecklistCard({ etfSymbol }: { etfSymbol: string | null }) {
  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Thesis Invalidation — Monitor Post-Entry</h2>
      <div className="flex flex-col divide-y divide-border">
        {INVALIDATION_ITEMS(etfSymbol).map((item, i) => (
          <div key={i} className="flex items-start gap-2 py-2 text-sm">
            <span className="min-w-[1.25rem] flex-none font-semibold text-danger">{i + 1}.</span>
            <span className="text-text-secondary">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SCORE_COMPONENT_LABELS: Record<string, string> = {
  breakdown: 'Breakdown severity & type', sector: 'Sector health', technical: 'Technical exhaustion',
  value: 'Value dislocation', catalyst: 'Catalyst pipeline',
};

function ContrarianScoreCard({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Contrarian Score</h2>
      <div className="flex flex-col gap-3">
        {(['breakdown', 'sector', 'technical', 'value', 'catalyst'] as const).map((key) => (
          <div key={key}>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">{SCORE_COMPONENT_LABELS[key]}</span>
              <span className="font-semibold text-text-primary">{score[key]}/2</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(score[key] / 2) * 100}%` }} />
            </div>
            {/* The "why" behind this factor's score - ported from the source
                app's compHints, never surfaced in this port until now. */}
            {score.hints[key] && <p className="mt-1 text-xs text-text-muted">{score.hints[key]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ValueDislocationCard({ vd }: { vd: ValueDislocation }) {
  const upsideBand = vd.sanityCheckTriggered
    ? { label: 'Value score forced to 0', tier: 'red' as const }
    : vd.analystUpsidePct > 40
      ? { label: 'Qualifies for 2/2 (>40%)', tier: 'green' as const }
      : vd.analystUpsidePct > 25
        ? { label: 'Qualifies for 1/2 (>25%)', tier: 'yellow' as const }
        : { label: 'Below threshold (≤25%)', tier: null };

  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Value Dislocation</h2>
      <div className="flex flex-col divide-y divide-border">
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-text-secondary">Trailing P/E</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{vd.peRatio != null ? `${vd.peRatio.toFixed(1)}×` : '—'}</span>
            {vd.peRatio != null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${vd.peRatio > 60 ? TIER_PILL_STYLES.red : TIER_PILL_STYLES.green}`}>
                {vd.peRatio > 60 ? 'High (>60)' : 'OK'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-text-secondary">Price/Sales</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{vd.priceToSales != null ? `${vd.priceToSales.toFixed(1)}×` : '—'}</span>
            {vd.priceToSales != null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${vd.priceToSales > 25 ? TIER_PILL_STYLES.red : TIER_PILL_STYLES.green}`}>
                {vd.priceToSales > 25 ? 'High (>25)' : 'OK'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-text-secondary">Analyst Upside</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{fmtPct(vd.analystUpsidePct)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${upsideBand.tier ? TIER_PILL_STYLES[upsideBand.tier] : 'bg-border text-text-secondary'}`}>
              {upsideBand.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared between the top ticker-form card (once a result exists) and nowhere
// else - symbol/company/sector, headline stats, and verdict badges. Split
// out so ContrarianComebackPage can render it next to the ticker form,
// matching Long-Term Analysis's own top-card layout.
function HeaderStats({ result }: { result: ContrarianComebackSubmitResult }) {
  const score = result.score;
  return (
    <div className="flex-1 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold text-text-primary">{result.symbol}</p>
          <p className="text-sm text-text-secondary">{result.companyName} {result.exchange ? `· ${result.exchange}` : ''}</p>
          <p className="text-xs text-text-muted">{result.sector}</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-lg font-semibold text-text-primary">{fmt$(result.price)}</p>
            <p className="text-xs text-text-muted">Current Price</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-danger">-{result.drawdownPct?.toFixed(1)}%</p>
            <p className="text-xs text-text-muted">Max Drawdown</p>
          </div>
          {score && (
            <div className={`rounded-btn px-3 py-1.5 text-center ${SCORE_BADGE_STYLES[score.verdict]}`}>
              <p className="text-lg font-semibold">{score.total}/10</p>
              <p className="text-xs opacity-80">Contra Score</p>
            </div>
          )}
        </div>
      </div>
      {score && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${VERDICT_STYLES[score.verdict]}`}>{score.verdict}</span>
          {score.hybridCapActive && <span className="text-xs text-warning">Cap rule: hybrid breakdown (7/10 max)</span>}
          {score.sectorOverrideCapActive && <span className="text-xs text-warning">⚠ Sector Override active (6/10 max)</span>}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: ContrarianComebackSubmitResult }) {
  if (result.format === 'B') {
    return <RejectionCard failedCheck={result.failedCheck} reason={result.reason} route={result.route} />;
  }

  const score = result.score;

  return (
    <div className="flex flex-col gap-4">
      {/* Section 1: Contrarian Score + Fundamental Health, side by side on md+.
          Header stats now live in the top ticker-form card (see HeaderStats). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {score && <ContrarianScoreCard score={score} />}
        {result.fundamentalHealth && <FundamentalHealthCard health={result.fundamentalHealth} />}
      </div>

      {/* Section 2: Value Dislocation + Technical Indicators, side by side on md+. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {result.valueDislocation && <ValueDislocationCard vd={result.valueDislocation} />}

        {(result.technicals || result.fibonacci) && (
          <div className="rounded-card bg-bg-card p-4 shadow-card">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">Technical Indicators</h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {result.technicals && (
                <>
                  <div><p className="text-xs text-text-muted">Weekly RSI (14)</p><p className="font-semibold text-text-primary">{result.technicals.weeklyRsi != null ? result.technicals.weeklyRsi.toFixed(1) : '—'}</p></div>
                  <div><p className="text-xs text-text-muted">OBV Trend</p><p className="font-semibold text-text-primary">{result.technicals.obvTrend}</p></div>
                  <div>
                    <p className="text-xs text-text-muted">Volume Trend</p>
                    <p className="font-semibold text-text-primary">
                      {result.technicals.volumeDrying ? 'Drying up' : 'Elevated'}
                      {result.technicals.volumeRatioPct != null && (
                        <span className="ml-1 text-xs font-normal text-text-muted">({result.technicals.volumeRatioPct.toFixed(0)}% of prior 4wk)</span>
                      )}
                    </p>
                  </div>
                  <div><p className="text-xs text-text-muted">200-Week SMA</p><p className="font-semibold text-text-primary">{fmt$(result.technicals.sma200w)}</p></div>
                  <div>
                    <p className="text-xs text-text-muted">
                      Volume Climax{' '}
                      <span
                        className="cursor-help"
                        title={
                          result.technicals.volumeClimax
                            ? "A single week's volume spiked to 2x+ the surrounding average - often capitulation selling near a bottom, a classic sign a decline is exhausting itself."
                            : `No single week spiked to 2x+ the surrounding average - current volume is ${result.technicals.volumeDrying ? 'drying up' : 'elevated'}${result.technicals.volumeRatioPct != null ? ` at ${result.technicals.volumeRatioPct.toFixed(0)}% of the prior 4-week average` : ''}, not a climax event.`
                        }
                      >
                        ⓘ
                      </span>
                    </p>
                    <p className={`font-semibold ${result.technicals.volumeClimax ? 'text-warning' : 'text-text-primary'}`}>
                      {result.technicals.volumeClimax ? 'Spike detected ⚠' : 'None detected'}
                    </p>
                  </div>
                </>
              )}
              {result.fibonacci && (
                <>
                  <div><p className="text-xs text-text-muted">Fibonacci 38.2%</p><p className="font-semibold text-text-primary">{fmt$(result.fibonacci.fib382)}</p></div>
                  <div><p className="text-xs text-text-muted">Fibonacci 61.8%</p><p className="font-semibold text-text-primary">{fmt$(result.fibonacci.fib618)}</p></div>
                  <div><p className="text-xs text-text-muted">Full Recovery (ATH)</p><p className="font-semibold text-text-primary">{fmt$(result.fibonacci.fib100)}</p></div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Catalyst Pipeline, standalone full-width (already has its own internal split). */}
      {result.catalystPipeline && <CatalystPipelineCard pipeline={result.catalystPipeline} />}

      {/* Section 4: Staged Entry Plan + Recovery Targets, side by side on md+. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {result.stagedEntry && <StagedEntryCard stagedEntry={result.stagedEntry} />}
        {result.recoveryTargets && <RecoveryTargetsCard targets={result.recoveryTargets} />}
      </div>

      {/* Section 5: Value Trap Check + Thesis Invalidation, side by side on md+. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ValueTrapChecklist />
        <InvalidationChecklistCard etfSymbol={result.etfSymbol} />
      </div>

      <p className="text-center text-xs text-text-muted">
        ⚠️ This analysis is for informational and educational purposes only. It does not constitute financial advice.
      </p>
    </div>
  );
}

// One history entry per symbol - the checklist answers + whichever stage of
// the gate/checklist/submit workflow that symbol has reached, so revisiting
// its sub-tab restores exactly where it was left, not just a final report.
interface CcEntryState {
  breakdownTypes: string[];
  catalystAnswer: 'yes' | 'no' | '';
  check3Override: boolean;
  check3OverrideReason: string;
  gateResult: ContrarianComebackGateResult;
  submitResult: ContrarianComebackSubmitResult | null;
}

export default function ContrarianComebackPage() {
  const [ticker, setTicker] = useState('');
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);

  const gate = useContrarianComebackGate();
  const submit = useContrarianComebackSubmit();
  const history = useTickerHistory<CcEntryState>({ storageKey: 'contrarianComeback:history' });

  const activeSymbol = history.activeSymbol;
  const activeEntry = history.active;

  function updateActive(patch: Partial<CcEntryState>) {
    if (!activeSymbol || !activeEntry) return;
    history.update(activeSymbol, { ...activeEntry, ...patch });
  }

  function toggleBreakdownType(value: string) {
    if (!activeEntry) return;
    const next = activeEntry.breakdownTypes.includes(value)
      ? activeEntry.breakdownTypes.filter((t) => t !== value)
      : [...activeEntry.breakdownTypes, value];
    updateActive({ breakdownTypes: next });
  }

  // Case 2 - switching to an already-cached sub-tab. Also clears any stale
  // gate/submit error from a previous failed lookup, which otherwise keeps
  // showing over the newly-selected (valid) tab since neither mutation ever
  // re-runs for it.
  function selectExisting(symbol: string) {
    gate.reset();
    submit.reset();
    history.select(symbol);
  }

  function runGate(symbol: string) {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return;
    if (history.has(upper)) { selectExisting(upper); return; } // Case 2
    setPendingSymbol(upper);
    gate.mutate(upper, {
      onSuccess: (gateResult) => {
        history.insert(upper, {
          breakdownTypes: [], catalystAnswer: '', check3Override: false, check3OverrideReason: '',
          gateResult, submitResult: null,
        }); // Case 1
        setPendingSymbol(null);
      },
      onError: () => setPendingSymbol(null), // Case 3 - history untouched, error shown below
    });
  }

  function handleCheckEligibility(e: FormEvent) {
    e.preventDefault();
    runGate(ticker);
  }

  useIncomingTicker('contrarian-comeback', (symbol) => {
    setTicker(symbol);
    runGate(symbol);
  });

  function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!activeEntry || !activeSymbol || activeEntry.catalystAnswer === '') return;
    submit.mutate({
      symbol: activeEntry.gateResult.symbol,
      breakdownTypes: activeEntry.breakdownTypes,
      catalystAnswer: activeEntry.catalystAnswer,
      check3Override: activeEntry.check3Override,
      check3OverrideReason: activeEntry.check3OverrideReason || undefined,
    }, {
      onSuccess: (submitResult) => {
        history.update(activeSymbol, { ...activeEntry, submitResult });
      },
    });
  }

  const missingKeyError = (gate.isError && gate.error instanceof ApiError && gate.error.status === 503)
    || (submit.isError && submit.error instanceof ApiError && submit.error.status === 503);
  const apiKeysModal = useApiKeysModal();

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

        {/* Ticker entry + header stats, side by side once a result exists -
            matches Long-Term Analysis's top-card layout (form + summary in
            one card instead of two stacked ones). */}
        <div className="flex flex-col gap-4 rounded-card bg-bg-card p-4 shadow-card lg:flex-row lg:items-start">
          <form onSubmit={handleCheckEligibility} className="flex flex-wrap items-end gap-3 lg:flex-none">
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
              disabled={gate.isPending}
              className="rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {gate.isPending ? 'Checking…' : 'Check Eligibility'}
            </button>
          </form>

          {activeEntry?.submitResult && activeEntry.submitResult.format === 'A' && <HeaderStats result={activeEntry.submitResult} />}
        </div>

        {!activeEntry?.gateResult && !gate.isPending && !gate.isError && (
          <div className="rounded-card bg-bg-card p-4 shadow-card text-sm text-text-secondary">
            <p>
              Screens a stock against a 5-check hard gate (drawdown severity, breakdown type, sector health,
              company viability, and a genuine recovery catalyst) before scoring it 0-10 on breakdown severity,
              sector health, technical exhaustion, value dislocation, and catalyst pipeline.
            </p>
            <p className="mt-2">Requires an FMP API key on file — <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">add one under API Keys</button>.</p>
          </div>
        )}

        {(gate.isError || submit.isError) && (
          <div className="text-sm text-danger">
            <p>
              {gate.isError && gate.error instanceof ApiError
                ? (gate.error.status === 404 ? 'Invalid Stock ticker' : gate.error.message)
                : submit.isError && submit.error instanceof ApiError ? submit.error.message
                : 'Analysis failed.'}
            </p>
            {missingKeyError && (
              <p className="mt-1">
                <button type="button" onClick={apiKeysModal.open} className="text-accent hover:underline">Add your FMP API key</button> to run an analysis.
              </p>
            )}
          </div>
        )}

        {activeEntry?.gateResult && activeEntry.gateResult.failedCheck && (
          <RejectionCard failedCheck={activeEntry.gateResult.failedCheck} reason={activeEntry.gateResult.reason} route={activeEntry.gateResult.route} />
        )}

        {activeEntry?.gateResult && !activeEntry.gateResult.failedCheck && !activeEntry.submitResult && (
          <GateForm
            gate={activeEntry.gateResult}
            breakdownTypes={activeEntry.breakdownTypes}
            onToggleBreakdownType={toggleBreakdownType}
            catalystAnswer={activeEntry.catalystAnswer}
            onCatalystAnswer={(value) => updateActive({ catalystAnswer: value })}
            check3Override={activeEntry.check3Override}
            onCheck3Override={(value) => updateActive({ check3Override: value })}
            check3OverrideReason={activeEntry.check3OverrideReason}
            onCheck3OverrideReason={(value) => updateActive({ check3OverrideReason: value })}
            onConfirm={handleConfirm}
            isPending={submit.isPending}
          />
        )}

        {activeEntry?.submitResult && (
          <>
            <button
              type="button"
              onClick={() => setPreviewSymbol(activeEntry.submitResult!.symbol)}
              className="self-start text-sm text-accent hover:underline"
            >
              View price chart
            </button>
            <ResultCard key={activeEntry.submitResult.symbol} result={activeEntry.submitResult} />
          </>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </>
  );
}
