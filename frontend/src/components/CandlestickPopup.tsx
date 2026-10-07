import { Fragment, useEffect, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart } from 'react-chartjs-2';
import '../lib/chartSetup';
import {
  useCandlestickSnapshot, useRefreshCandlestick, useCachedSymbolsList,
  CANDLESTICK_INTERVALS, type CandlestickInterval, type CandlestickIndicators,
} from '../api/candlestick';
import { useSession } from '../api/auth';
import { formatAsOf, formatCurrency } from '../lib/format';
import {
  HORIZON_INDICATORS, HORIZON_TITLES, INDICATOR_LABELS, INTERVAL_HORIZON, type IndicatorKey,
} from '../lib/candlestickIndicators';
import {
  detectPatterns, PATTERN_KEYS, PATTERN_LABELS, DOJI_FAMILY_PATTERN_KEYS, COMPLEX_PATTERN_KEYS,
  ADVANCED_PATTERN_KEYS, FIVE_CANDLE_PATTERN_KEYS,
  type CandlestickPatternKey,
} from '../lib/candlestickPatternDetection';
import { detectComplexPatterns } from '../lib/candlestickComplexPatternDetection';
import RateLimitIndicator from './RateLimitIndicator';
import CandlestickQuickReference from './CandlestickQuickReference';
import CandlestickPatternBadge from './CandlestickPatternBadge';

const INTERVAL_LABELS: Record<CandlestickInterval, string> = {
  '5min': '5 Min', '15min': '15 Min', '30min': '30 Min', '1hour': '1 Hour', '4hour': '4 Hour', '1day': '1 Day',
};

interface CandlestickPopupProps {
  symbol: string;
  initialInterval: CandlestickInterval;
  onClose: () => void;
}

// Candlestick vs. Quick Reference - a static tab living inside this same "Stock Details" popup
// (not a new top-level app tab, per explicit direction) since it's meant to help interpret the
// diagram you're already looking at, not stand alone as its own destination. Named/positioned
// (see the header below) to make the hierarchy explicit: Candlestick and Quick Reference are the
// two parent-level tabs; the timeframe buttons are children of Candlestick only.
type PopupView = 'candlestick' | 'quickReference';

export default function CandlestickPopup({ symbol, initialInterval, onClose }: CandlestickPopupProps) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  // Candlestick Pattern Q&A (Phase 1) - gated Function, zero default grants, same
  // hidden-not-shown pattern used everywhere else in this app for a permission the caller
  // might not hold.
  const canCandlestickQuestionAnswer = session?.permissions?.includes('candlestick_question_answer:ask') ?? false;
  // In-popup symbol switcher (2026-09-28) - `symbol` is only the seed for how this popup was
  // originally opened (from CandlestickSymbolList.tsx's own left-hand panel or a fresh lookup);
  // `activeSymbol` is the popup's own internal source of truth from here on, so switching symbols
  // via the new dropdown below never needs to notify the parent - deliberately mirrors the
  // existing interval/initialInterval seed-once pattern one line down.
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [symbolSwitcherOpen, setSymbolSwitcherOpen] = useState(false);
  const [view, setView] = useState<PopupView>('candlestick');
  const [interval, setInterval] = useState<CandlestickInterval>(initialInterval);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(new Set());
  // Pattern Detection panel (2026-09-26 POC, initially 1-Day only, expanded to every interval
  // 2026-09-27) - visiblePatterns defaults to all shown; the picker only toggles which badges are
  // visible, since detecting all of them is cheap enough to always run together rather than
  // recomputing per toggle. priceChartRef/layoutTick
  // let the badge strip read the price chart's own Chart.js x-scale for pixel-perfect alignment,
  // recomputed via the price chart's own afterRender hook rather than a bespoke ResizeObserver.
  const [visiblePatterns, setVisiblePatterns] = useState<Set<CandlestickPatternKey>>(new Set(PATTERN_KEYS));
  const [patternPickerOpen, setPatternPickerOpen] = useState(false);
  // The Complex (2-candle) and Advanced (3-candle) tiers - both deliberately on-demand, unlike
  // the always-on simple panel: each defaults EMPTY (nothing drawn until explicitly picked).
  // Split into two tiers 2026-09-27 (was one combined "Complex" set) so a self-directed investor
  // can opt into complexity at their own level - see candlestickPatternDetection.ts's own comment
  // on the candle-count rule. Complex was originally rendered as an overlay directly on the price
  // chart itself; moved to its own strip below PatternPanel after live use kept showing a "the
  // graph jerks" hover bug - see ComplexPatternPanel's own comment for the root cause.
  const [visibleComplexPatterns, setVisibleComplexPatterns] = useState<Set<CandlestickPatternKey>>(new Set());
  const [complexPatternPickerOpen, setComplexPatternPickerOpen] = useState(false);
  const [visibleAdvancedPatterns, setVisibleAdvancedPatterns] = useState<Set<CandlestickPatternKey>>(new Set());
  const [advancedPatternPickerOpen, setAdvancedPatternPickerOpen] = useState(false);
  // The Complex tier (5 candles, 2026-10-03) - same on-demand/defaults-empty precedent as
  // Composite/Advanced above. Named "Complex5" internally (state/handlers/component) to avoid
  // colliding with the pre-existing "Complex" identifiers that already mean the 2-candle/Composite
  // tier (a legacy mismatch from the 2026-09-28 rename) - see candlestickPatternDetection.ts's own
  // FIVE_CANDLE_PATTERN_KEYS comment for the full naming rationale.
  const [visibleComplex5Patterns, setVisibleComplex5Patterns] = useState<Set<CandlestickPatternKey>>(new Set());
  const [complex5PatternPickerOpen, setComplex5PatternPickerOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own instance type, kept loose like the rest of this file's Chart.js interop
  const priceChartRef = useRef<any>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const { data: snapshot, isLoading } = useCandlestickSnapshot(activeSymbol, interval);
  const refresh = useRefreshCandlestick();

  // Opening a symbol (clicking it in the left-hand panel, or switching via the in-popup symbol
  // switcher below) is itself a signal the user wants current data, not whatever happens to be
  // sitting in the shared daily cache from however many days ago - 2026-09-25, explicit direction,
  // scoped to the 1-Day view specifically (the default view; other intervals have their own much
  // shorter 10-minute freshness window and aren't included here). Fires at most once per symbol
  // (the ref, not just checking snapshot.isFresh in the effect body) so it can't re-fire on every
  // render while the mutation is in flight, and won't repeatedly re-trigger if the user later
  // flips away from 1-Day and back for the same symbol. Goes through the exact same rate-limited
  // refresh() the manual button uses - no special-casing, so an exhausted limit surfaces the same
  // error.
  const autoRefreshedRef = useRef(false);
  // Per-symbol bookkeeping, not a user preference (unlike interval/indicators/pattern picks, which
  // the symbol switcher deliberately leaves untouched) - reset so a freshly-switched-to symbol
  // still gets its own one-time 1-Day auto-refresh instead of being silently suppressed by the
  // *previous* symbol having already used it up.
  useEffect(() => {
    autoRefreshedRef.current = false;
  }, [activeSymbol]);
  useEffect(() => {
    if (autoRefreshedRef.current) return;
    if (interval !== '1day' || isLoading || !snapshot || snapshot.isFresh) return;
    autoRefreshedRef.current = true;
    refresh.mutate({ symbol: activeSymbol, interval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, isLoading, snapshot]);

  // Indicator relevance filtering (2026-09-20, per explicit direction, "based on Quick
  // Reference's own relevance") - CandlestickQuickReference.tsx's Core Indicators lists are the
  // single source of truth for "what's relevant at this horizon"; HORIZON_INDICATORS/
  // HORIZON_TITLES are derived directly from that same content (see that file's own comments),
  // so this filtering can never drift out of sync with what that tab actually teaches.
  const horizon = INTERVAL_HORIZON[interval];
  const relevantIndicators = HORIZON_INDICATORS[horizon];

  // A real usability gap this closes: without this, an indicator toggled on at one timeframe
  // (e.g. VWAP on a 5-min chart) stayed toggled on - and its overlay kept rendering - after
  // switching to a timeframe where it's actively misleading (VWAP on a 1-Day chart) or where its
  // own toggle button is no longer even shown, leaving no way to turn it back off. Pruning
  // activeIndicators to the new timeframe's relevant set whenever `interval` changes keeps the
  // toggle row and the chart's actual overlays always in agreement.
  useEffect(() => {
    setActiveIndicators((prev) => {
      const next = new Set([...prev].filter((key) => HORIZON_INDICATORS[INTERVAL_HORIZON[interval]].includes(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [interval]);

  function toggleIndicator(key: IndicatorKey) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleVisiblePattern(key: CandlestickPatternKey) {
    setVisiblePatterns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleVisibleComplexPattern(key: CandlestickPatternKey) {
    setVisibleComplexPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleVisibleAdvancedPattern(key: CandlestickPatternKey) {
    setVisibleAdvancedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleVisibleComplex5Pattern(key: CandlestickPatternKey) {
    setVisibleComplex5Patterns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // "All" checkbox (2026-09-28) at the top of each picker's own dropdown - a toggle, not a
  // one-way "select everything" action: checking it when not everything is already shown selects
  // every key in that tier's own patternKeys; checking it again (now that everything IS shown)
  // clears back to empty, consistent with every other checkbox in these popovers already being a
  // plain toggle. Four small handlers rather than one generic one, same
  // small-intentional-duplication convention this file already uses for
  // toggleVisiblePattern/toggleVisibleComplexPattern/toggleVisibleAdvancedPattern/
  // toggleVisibleComplex5Pattern above.
  function toggleAllPatterns() {
    setVisiblePatterns((prev) => (prev.size === PATTERN_KEYS.length ? new Set() : new Set(PATTERN_KEYS)));
  }

  function toggleAllComplexPatterns() {
    setVisibleComplexPatterns((prev) => (prev.size === COMPLEX_PATTERN_KEYS.length ? new Set() : new Set(COMPLEX_PATTERN_KEYS)));
  }

  function toggleAllAdvancedPatterns() {
    setVisibleAdvancedPatterns((prev) => (prev.size === ADVANCED_PATTERN_KEYS.length ? new Set() : new Set(ADVANCED_PATTERN_KEYS)));
  }

  function toggleAllComplex5Patterns() {
    setVisibleComplex5Patterns((prev) => (prev.size === FIVE_CANDLE_PATTERN_KEYS.length ? new Set() : new Set(FIVE_CANDLE_PATTERN_KEYS)));
  }

  function handleFetch() {
    refresh.mutate({ symbol: activeSymbol, interval });
  }

  // Deliberately does NOT touch `interval` - per explicit direction, switching symbols via the
  // in-popup switcher preserves the currently selected interval/indicators/pattern picks, unlike
  // opening a fresh popup from CandlestickSymbolList.tsx's own panel (which always defaults a
  // brand-new lookup to 1day).
  function handleSelectSymbol(newSymbol: string) {
    setActiveSymbol(newSymbol);
    setSymbolSwitcherOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary" data-testid="candlestick-popup">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-secondary px-4 py-3">
        <SymbolSwitcher
          activeSymbol={activeSymbol}
          open={symbolSwitcherOpen}
          onToggleOpen={() => setSymbolSwitcherOpen((prev) => !prev)}
          onSelectSymbol={handleSelectSymbol}
        />

        {/* Candlestick - the first of the two parent-level tabs, positioned right next to the
            ticker since it's the default/primary view - plus its timeframe children, all one
            single-line grouped panel (border+background) so the whole thing visually reads as
            one unit distinct from the separate Quick Reference tab below. The timeframe buttons
            are disabled (not hidden - keeps the single-line layout stable) whenever Quick
            Reference is active: a real usability bug found live 2026-09-20 - they used to stay
            fully clickable there, silently changing `interval` state with no visible effect
            since Quick Reference has no chart to apply it to. A vertical divider marks where
            Candlestick ends and its children begin. */}
        <div
          className={`flex items-center gap-1 rounded-btn border px-1.5 py-1 transition-colors ${
            view === 'candlestick' ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-primary/60'
          }`}
          data-testid="candlestick-panel"
        >
          <button
            type="button"
            onClick={() => setView('candlestick')}
            data-testid="candlestick-view-candlestick"
            className={`rounded-btn px-2.5 py-1 text-sm font-medium transition-colors ${
              view === 'candlestick' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
            }`}
          >
            Candlestick
          </button>
          <div className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <div className="flex flex-wrap gap-1" data-testid="candlestick-interval-selector">
            {CANDLESTICK_INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                disabled={view !== 'candlestick'}
                data-testid={`candlestick-interval-${iv}`}
                className={`rounded-btn px-2 py-1 text-xs font-medium transition-colors ${
                  view !== 'candlestick'
                    ? 'cursor-not-allowed text-text-muted opacity-50'
                    : interval === iv ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-primary'
                }`}
              >
                {INTERVAL_LABELS[iv]}
              </button>
            ))}
          </div>
        </div>

        {/* Back link (2026-09-25, explicit direction) - replaces the old Close button, which sat
            all the way at the extreme right, easy to miss/far from where attention already is
            right after picking a timeframe. Positioned immediately next to the timeframe panel
            instead, and reads as plain navigation ("go back to where I was") rather than an
            action that implies discarding something. Still just calls onClose() underneath -
            this popup was never a real route, so "back" and "close" are the same action.
            Styled as a real hyperlink (accent color + a permanent underline, not just on hover)
            per explicit follow-up direction the same day - it was reading as flat, static text. */}
        <button
          type="button"
          onClick={onClose}
          data-testid="candlestick-popup-back"
          className="text-sm font-medium text-accent underline decoration-accent/50 underline-offset-2 transition-colors hover:text-accent-hover hover:decoration-accent"
        >
          ← Back
        </button>

        {/* TabShell's own header (and its own RateLimitIndicator) sits fully behind this
            fixed, opaque, full-viewport popup - the one view in this app that otherwise hides
            it entirely, so the badge is repeated here too. RateLimitIndicator self-guards on
            exempt/loading/error, so it's safe to render unconditionally. */}
        <RateLimitIndicator />

        {/* Ask about patterns + Quick Reference, one wrapping group (2026-09-25, explicit
            direction) - both previously carried their OWN independent ml-auto, which pushed each
            to the far right of whichever flex-wrap LINE it happened to land on individually. On a
            narrower popup width this let the row wrap such that Ask about patterns landed alone
            on its own line, nowhere near Quick Reference - a real "eyesore in the middle of the
            screen" bug, not just a cosmetic preference. Wrapping both in one flex container and
            putting ml-auto on the wrapper instead guarantees they always wrap and land together,
            with Quick Reference's own tab styling and Ask-about-patterns' link styling now
            visibly distinct from each other (a solid button vs. an underlined link), rather than
            both reading as plain, indistinguishable labels. */}
        <div className="ml-auto flex items-center gap-3">
          {/* Candlestick Pattern Q&A (Phase 1) - a contextual shortcut, not a third tab of this
              popup (patterns aren't symbol-specific, so this closes the popup entirely and
              navigates to that feature's own top-level tab, per explicit "UI placement: both"
              direction). Hidden entirely without candlestick_question_answer:ask. */}
          {canCandlestickQuestionAnswer && (
            <button
              type="button"
              onClick={() => { onClose(); navigate('/candlestick-question-answer'); }}
              data-testid="candlestick-ask-about-patterns"
              className="text-sm font-medium text-accent underline decoration-accent/50 underline-offset-2 transition-colors hover:text-accent-hover hover:decoration-accent"
            >
              Ask about patterns →
            </button>
          )}

          {/* Quick Reference - the second parent-level tab (mirroring Candlestick's placement
              next to the ticker on the far left) so the two tabs read as the page's real
              top-level choice, not lost among the timeframe buttons. Carries its own border/
              background even at rest (not just on hover), same treatment as the Candlestick
              panel's own bordered container - plain text-only styling here read as static, not
              clickable (2026-09-25 follow-up). */}
          <button
            type="button"
            onClick={() => setView('quickReference')}
            data-testid="candlestick-view-quick-reference"
            className={`rounded-btn border px-2.5 py-1 text-sm font-medium transition-colors ${
              view === 'quickReference'
                ? 'border-accent/40 bg-accent text-white'
                : 'border-border bg-bg-primary/60 text-text-secondary hover:bg-bg-primary'
            }`}
          >
            Quick Reference
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {view === 'quickReference' && <CandlestickQuickReference />}

        {view === 'candlestick' && isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

        {view === 'candlestick' && !isLoading && !snapshot && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" data-testid="candlestick-confirm-fetch">
            <p className="text-sm text-text-secondary">
              No cached data for {activeSymbol} at {INTERVAL_LABELS[interval]} yet.
            </p>
            {refresh.isError && <p className="text-sm text-danger">{(refresh.error as Error)?.message}</p>}
            <button
              type="button"
              onClick={handleFetch}
              disabled={refresh.isPending}
              data-testid="candlestick-confirm-fetch-button"
              className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {refresh.isPending ? 'Fetching…' : 'Fetch fresh data (uses 1 of your limit)'}
            </button>
          </div>
        )}

        {view === 'candlestick' && !isLoading && snapshot && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {/* Best-effort - null whenever no other feature has looked up this symbol's quote
                  yet today (peekCompanyName() never spends a real fetch just for this), so it's
                  entirely absent rather than showing a blank/placeholder name. */}
              {snapshot.companyName && (
                <span className="text-sm font-bold text-text-primary" data-testid="candlestick-company-name">
                  {snapshot.companyName}
                </span>
              )}
              <span
                data-testid="candlestick-freshness-badge"
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  snapshot.isFresh ? 'bg-success/10 text-success' : 'bg-border text-text-secondary'
                }`}
              >
                {snapshot.isFresh ? 'Fresh' : 'Stale'}
              </span>
              <span className="text-xs text-text-secondary" data-testid="candlestick-time-of-pull">
                Pulled {formatAsOf(snapshot.updatedAt)}
              </span>
              {!snapshot.isFresh && (
                <button
                  type="button"
                  onClick={handleFetch}
                  disabled={refresh.isPending}
                  data-testid="candlestick-refresh-button"
                  className="text-xs text-accent hover:underline disabled:opacity-60"
                >
                  {refresh.isPending ? 'Refreshing…' : 'Refresh (uses 1 of your limit)'}
                </button>
              )}
              {refresh.isError && <p className="text-xs text-danger">{(refresh.error as Error)?.message}</p>}
            </div>

            <p className="mb-1.5 text-xs text-text-muted" data-testid="candlestick-horizon-caption">
              Showing indicators relevant to <span className="font-medium text-text-secondary">{HORIZON_TITLES[horizon]}</span> - see Quick Reference for why.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5" data-testid="candlestick-indicator-toggles">
              {(Object.keys(INDICATOR_LABELS) as IndicatorKey[]).filter((key) => relevantIndicators.includes(key)).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleIndicator(key)}
                  data-testid={`candlestick-toggle-${key}`}
                  aria-pressed={activeIndicators.has(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeIndicators.has(key)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:bg-bg-card'
                  }`}
                >
                  {INDICATOR_LABELS[key]}
                </button>
              ))}
            </div>

            {/* Pattern Detection (2026-09-26 POC, initially 1-Day only - extended 2026-09-27 to
                every interval, since detection is pure geometry on {open,high,low,close} and
                never depended on the bar's timeframe). The 4 pickers only control which of the
                already-detected patterns show as badges (each tier gets its own strip below the
                price chart); none of them re-run detection.
                2026-09-28 UI tightening (explicit direction): a single "Pattern:" label instead
                of each picker repeating its own full description, all pickers grouped inside
                one enclosed border+background box - the same visual treatment the
                Candlestick/timeframe selector above already uses for its own grouped controls -
                with each picker's own sub-label shortened to just its tier name. A 4th picker
                (Complex, the 5-candle tier) was added 2026-10-03, same treatment. */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              <span className="font-medium">Pattern:</span>
              <div
                className="flex items-center gap-1 rounded-btn border border-border bg-bg-primary/60 px-1.5 py-1"
                data-testid="candlestick-pattern-tier-group"
              >
                <div className="flex items-center gap-1" data-testid="candlestick-pattern-picker-row">
                  <span className="text-text-muted">Simple</span>
                  <PatternPicker
                    open={patternPickerOpen}
                    onToggleOpen={() => setPatternPickerOpen((o) => !o)}
                    visible={visiblePatterns}
                    onTogglePattern={toggleVisiblePattern}
                    onToggleAll={toggleAllPatterns}
                    patternKeys={PATTERN_KEYS}
                    testIdPrefix="candlestick-pattern-picker"
                  />
                </div>
                <div className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-center gap-1" data-testid="candlestick-complex-pattern-picker-row">
                  <span className="text-text-muted">Composite</span>
                  <PatternPicker
                    open={complexPatternPickerOpen}
                    onToggleOpen={() => setComplexPatternPickerOpen((o) => !o)}
                    visible={visibleComplexPatterns}
                    onTogglePattern={toggleVisibleComplexPattern}
                    onToggleAll={toggleAllComplexPatterns}
                    patternKeys={COMPLEX_PATTERN_KEYS}
                    testIdPrefix="candlestick-complex-pattern-picker"
                  />
                </div>
                <div className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-center gap-1" data-testid="candlestick-advanced-pattern-picker-row">
                  <span className="text-text-muted">Advanced</span>
                  <PatternPicker
                    open={advancedPatternPickerOpen}
                    onToggleOpen={() => setAdvancedPatternPickerOpen((o) => !o)}
                    visible={visibleAdvancedPatterns}
                    onTogglePattern={toggleVisibleAdvancedPattern}
                    onToggleAll={toggleAllAdvancedPatterns}
                    patternKeys={ADVANCED_PATTERN_KEYS}
                    testIdPrefix="candlestick-advanced-pattern-picker"
                  />
                </div>
                <div className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-center gap-1" data-testid="candlestick-complex5-pattern-picker-row">
                  <span className="text-text-muted">Complex</span>
                  <PatternPicker
                    open={complex5PatternPickerOpen}
                    onToggleOpen={() => setComplex5PatternPickerOpen((o) => !o)}
                    visible={visibleComplex5Patterns}
                    onTogglePattern={toggleVisibleComplex5Pattern}
                    onToggleAll={toggleAllComplex5Patterns}
                    patternKeys={FIVE_CANDLE_PATTERN_KEYS}
                    testIdPrefix="candlestick-complex5-pattern-picker"
                  />
                </div>
              </div>
            </div>

            {/* TierLine (2026-09-28, explicit direction) - prefixes each of the 5 lines with its
                own tier label (blank for the price chart itself) without disturbing badge/candle
                alignment - see TierLine's own comment for why a naive inline-left label would
                have broken that alignment, and why this wrapper approach doesn't. A 4th tier
                (Complex, 5-candle) was appended 2026-10-03, same treatment. */}
            <TierLine label="">
              <PriceChart
                bars={snapshot.bars}
                indicators={snapshot.indicators}
                activeIndicators={activeIndicators}
                chartRef={priceChartRef}
                onLayout={() => setLayoutTick((t) => t + 1)}
              />
            </TierLine>
            <TierLine label="Simple">
              <PatternPanel
                bars={snapshot.bars}
                visiblePatterns={visiblePatterns}
                priceChartRef={priceChartRef}
                layoutTick={layoutTick}
              />
            </TierLine>
            <TierLine label="Composite">
              <ComplexPatternPanel
                bars={snapshot.bars}
                visiblePatterns={visibleComplexPatterns}
                priceChartRef={priceChartRef}
                layoutTick={layoutTick}
              />
            </TierLine>
            <TierLine label="Advanced">
              <AdvancedPatternPanel
                bars={snapshot.bars}
                visiblePatterns={visibleAdvancedPatterns}
                priceChartRef={priceChartRef}
                layoutTick={layoutTick}
              />
            </TierLine>
            <TierLine label="Complex">
              <Complex5PatternPanel
                bars={snapshot.bars}
                visiblePatterns={visibleComplex5Patterns}
                priceChartRef={priceChartRef}
                layoutTick={layoutTick}
              />
            </TierLine>
            <VolumeChart bars={snapshot.bars} indicators={snapshot.indicators} activeIndicators={activeIndicators} />
            {activeIndicators.has('rsi') && <RsiChart bars={snapshot.bars} rsi14={snapshot.indicators.rsi14} />}
            {activeIndicators.has('macd') && <MacdChart bars={snapshot.bars} macd={snapshot.indicators.macd} />}
          </>
        )}
      </div>
    </div>
  );
}

// Prefixes one of the 5 stacked lines (price chart, Simple, Composite, Advanced, Complex) with its
// own tier label (2026-09-28, explicit direction; Complex appended 2026-10-03). Badges in the 4
// pattern strips below are positioned with `left: ${pixel}px`, where pixel comes from the PRICE
// CHART's own Chart.js x-scale (getPixelForValue) - that pixel value is only meaningful if a
// strip's own relatively-positioned container starts at the exact same horizontal offset as the
// price chart's own canvas does. A label placed inline to the left of just the pattern strips (not
// the chart itself) would shift those containers rightward relative to the chart above them,
// silently breaking alignment between a badge and the candle it's meant to sit under.
// Fix: apply this SAME wrapper - a fixed-width label column, then the real content in a flex-1
// column - to ALL 5 lines, including the price chart itself (with an empty label). Since every
// line's content column is offset from its own row's left edge by the identical amount, the
// coordinate system getPixelForValue() returns stays valid with zero numeric adjustment anywhere
// - no pixel-math changes needed in PriceChart or any pattern panel, just this consistent
// wrapper. Purely a horizontal layout - adds no vertical height, so it doesn't interact with the
// 1px inter-line spacing (see PriceChart/MultiCandlePatternPanel's own margin comments) at all.
function TierLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-20 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted"
        aria-hidden={!label}
      >
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface ChartBars {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Reverses newest-first API bars into chronological (oldest-first) order, matching how a
// left-to-right axis needs to read.
function toChronological(bars: ChartBars[]): ChartBars[] {
  return [...bars].reverse();
}

// Phase 1.1 - bars are positioned by their plain sequence INDEX (0, 1, 2...), not by real
// elapsed time, so weekend/overnight gaps between trading sessions no longer draw to scale and
// squash each session's real price action into a narrow sliver (verified live: this was
// flattening moving-average overlays into a misleading staircase). Every dataset across all four
// stacked panels shares this same index positioning to stay visually aligned. The real date is
// recovered for tick labels/tooltips by looking up the index in `chronological` (see
// makeIndexAxisTicks/makeTooltipTitleCallback below).
function formatTickLabel(dateStr: string): string {
  const hasTime = dateStr.includes(' ');
  const d = new Date(dateStr.replace(' ', 'T'));
  // A bare daily-bar date ("2026-09-21", no time component) parses as UTC midnight - without
  // pinning timeZone: 'UTC' here, toLocaleDateString renders it in the VIEWER's local timezone,
  // which falls on the previous calendar day for anyone west of UTC (found live 2026-09-25: a
  // real Monday bar was displaying as "Sun"). Same fix already applied once before for this exact
  // bug class in usageDates.ts. Intraday bars (hasTime) aren't affected - they already carry a
  // real local trading-session time, not a bare date.
  return hasTime
    ? d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Pins the x-axis exactly to the real data range (0 to the last bar's index). Without this,
// Chart.js's default `bounds: 'ticks'` behavior on a linear scale with no explicit min/max
// rounds the axis out to the nearest "nice" tick step on each side independently - a real,
// asymmetric gap before the first bar and after the last one (found live 2026-09-19: measured
// ~3x more empty space on the right than the left on a real chart, with no intentional reason
// for either gap). Also keeps all four stacked panels (Price/Volume/RSI/MACD) pinned to the
// identical range, so they can't drift out of alignment with each other the way each computing
// its own auto-bounds independently could.
//
// offset: false is the other half of this fix, found live 2026-09-20 after min/max alone still
// left a large (~185px, exactly 10% of the plot width) symmetric margin on both sides -
// chartjs-chart-financial's FinancialController sets `scales.x.offset: true` as its own default
// (inherited from Chart.js's BarController, meant for category-style bar charts that reserve a
// half-band of space around the first/last bar so it isn't flush against the plot edge). That
// default silently survives here since this file overrides `type`/min/max but never touched
// `offset` - on this linear, non-category index scale it doesn't compute a sensible half-band,
// so Chart.js falls back to a flat 10%-of-width margin on each side instead. Confirmed live via
// direct Chart.js instance introspection (chart.scales.x.getPixelForValue(0/max) sitting ~185px
// inside chartArea.left/right on a real chart) before concluding this, not guessed.
function indexAxisBounds(chronological: ChartBars[]): { min: number; max: number; offset: boolean } {
  return { min: 0, max: Math.max(chronological.length - 1, 0), offset: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own tick callback signature, kept loose like the rest of this file's chart options
function makeIndexAxisTicks(chronological: ChartBars[], display: boolean): any {
  return {
    display,
    autoSkip: true,
    maxRotation: 0,
    maxTicksLimit: 8,
    callback: (value: string | number) => {
      const bar = chronological[Math.round(Number(value))];
      return bar ? formatTickLabel(bar.date) : '';
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own tooltip item shape, kept loose like the rest of this file's chart options
function makeTooltipTitleCallback(chronological: ChartBars[]) {
  return (items: any[]): string => {
    const item = items[0];
    const idx = Math.round(item?.parsed?.x ?? item?.dataIndex ?? 0);
    const bar = chronological[idx];
    return bar ? formatTickLabel(bar.date) : '';
  };
}

// Series-shaped indicator values are newest-first (same convention as `bars`, same length) with
// `null` where there isn't enough trailing history yet. Reverses to chronological order (index i
// = the i-th chronological bar) and drops nulls so Chart.js gets a clean, gapless line. Takes
// only the series, not `bars` - a real pairing bug found while making this change: the previous
// version reversed the series but zipped it against the ORIGINAL (still newest-first) `bars`
// array by the same index, silently mismatching every point's x/y except the exact midpoint
// (bars[0] - the newest bar - was paired with chronological[0] - the OLDEST series value, and so
// on). Both sides need the same ordering to line up; using the series' own length for indices
// removes the second array entirely rather than needing to keep two arrays in sync.
function seriesToPoints(series: (number | null)[] | null | undefined): { x: number; y: number }[] {
  if (!series) return [];
  return [...series].reverse()
    .map((y, i) => ({ x: i, y }))
    .filter((p): p is { x: number; y: number } => p.y != null);
}

function flatLine(chronologicalLength: number, value: number): { x: number; y: number }[] {
  if (chronologicalLength === 0) return [];
  return [{ x: 0, y: value }, { x: chronologicalLength - 1, y: value }];
}

const OVERLAY_COLORS = {
  sma20: '#3b82f6', sma50: '#f59e0b', ema20: '#a855f7', bbBand: '#94a3b8', bbMid: '#64748b',
  vwap: '#14b8a6', pivot: '#ef4444', fib: '#eab308', volumeMa: '#0ea5e9', obv: '#a855f7',
};

function PriceChart({ bars, indicators, activeIndicators, chartRef, onLayout }: {
  bars: ChartBars[]; indicators: CandlestickIndicators; activeIndicators: Set<IndicatorKey>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own instance type, kept loose like the rest of this file's Chart.js interop
  chartRef?: MutableRefObject<any>;
  onLayout?: () => void;
}) {
  const chronological = toChronological(bars);
  const candleData = chronological.map((b, i) => ({ x: i, o: b.open, h: b.high, l: b.low, c: b.close }));

  // chartjs-chart-financial's dataset shape isn't fully compatible with react-chartjs-2's own
  // mixed-dataset typing (Chart<"candlestick"> only accepts FinancialDataPoint[] datasets, not
  // the line/bar overlays mixed in below) - same untyped-array escape hatch every Chart.js
  // consumer mixing dataset types needs; its own README examples do the same.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  const datasets: any[] = [
    { label: 'Price', data: candleData, borderColor: '#16a34a', color: { up: '#16a34a', down: '#dc2626', unchanged: '#94a3b8' } },
  ];

  if (activeIndicators.has('ma')) {
    datasets.push({ type: 'line', label: 'SMA 20', data: seriesToPoints(indicators.sma20), borderColor: OVERLAY_COLORS.sma20, borderWidth: 1.5, pointRadius: 0 });
    datasets.push({ type: 'line', label: 'SMA 50', data: seriesToPoints(indicators.sma50), borderColor: OVERLAY_COLORS.sma50, borderWidth: 1.5, pointRadius: 0 });
    if (indicators.ema20) datasets.push({ type: 'line', label: 'EMA 20', data: seriesToPoints(indicators.ema20), borderColor: OVERLAY_COLORS.ema20, borderWidth: 1.5, pointRadius: 0 });
  }
  if (activeIndicators.has('bb')) {
    const upper = indicators.bb20.map((v) => (v ? v.upper : null));
    const mid = indicators.bb20.map((v) => (v ? v.mid : null));
    const lower = indicators.bb20.map((v) => (v ? v.lower : null));
    datasets.push({ type: 'line', label: 'BB Upper', data: seriesToPoints(upper), borderColor: OVERLAY_COLORS.bbBand, borderWidth: 1, pointRadius: 0, borderDash: [4, 3] });
    datasets.push({ type: 'line', label: 'BB Mid', data: seriesToPoints(mid), borderColor: OVERLAY_COLORS.bbMid, borderWidth: 1, pointRadius: 0 });
    datasets.push({ type: 'line', label: 'BB Lower', data: seriesToPoints(lower), borderColor: OVERLAY_COLORS.bbBand, borderWidth: 1, pointRadius: 0, borderDash: [4, 3] });
  }
  if (activeIndicators.has('vwap')) {
    datasets.push({ type: 'line', label: 'VWAP', data: seriesToPoints(indicators.vwap), borderColor: OVERLAY_COLORS.vwap, borderWidth: 1.5, pointRadius: 0 });
  }
  if (activeIndicators.has('pivotPoints') && indicators.pivotPoints) {
    const pp = indicators.pivotPoints;
    (['pp', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const).forEach((key) => {
      datasets.push({ type: 'line', label: `Pivot ${key.toUpperCase()}`, data: flatLine(chronological.length, pp[key]), borderColor: OVERLAY_COLORS.pivot, borderWidth: key === 'pp' ? 1.5 : 1, pointRadius: 0, borderDash: key === 'pp' ? [] : [2, 3] });
    });
  }
  if (activeIndicators.has('fibonacci') && indicators.fibonacci) {
    indicators.fibonacci.levels.forEach((level) => {
      datasets.push({ type: 'line', label: `Fib ${(level.pct * 100).toFixed(1)}%`, data: flatLine(chronological.length, level.price), borderColor: OVERLAY_COLORS.fib, borderWidth: 1, pointRadius: 0, borderDash: [3, 2] });
    });
  }

  return (
    <div className="mb-px h-96" data-testid="candlestick-price-chart">
      <Chart
        ref={chartRef}
        type="candlestick"
        data={{ datasets }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ...indexAxisBounds(chronological), ticks: makeIndexAxisTicks(chronological, true) }, y: { position: 'right' } },
          plugins: {
            legend: { display: activeIndicators.size > 0, labels: { boxHeight: 6 } },
            tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } },
          },
        }}
        // Reused to recompute the Pattern Detection panel's badge pixel positions whenever the
        // price chart lays out - both on first render and on every resize-driven relayout, since
        // Chart.js is `responsive: true` by default and already re-runs this on resize. Avoids a
        // bespoke ResizeObserver just for this.
        plugins={onLayout ? [{ id: 'reportPriceChartLayout', afterRender: onLayout }] : []}
      />
    </div>
  );
}

// Compact K/M formatting for volume's y-axis - "4,000,000" is much harder to scan at a glance
// than "4M". Strips a trailing ".0" so round numbers ("2M", not "2.0M") stay clean.
function formatVolumeTick(tickValue: string | number): string {
  const value = Number(tickValue);
  const abs = Math.abs(value);
  const withSuffix = (divisor: number, suffix: string) => {
    const rounded = (value / divisor).toFixed(1);
    return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}${suffix}`;
  };
  if (abs >= 1_000_000) return withSuffix(1_000_000, 'M');
  if (abs >= 1_000) return withSuffix(1_000, 'K');
  return String(value);
}

function VolumeChart({ bars, indicators, activeIndicators }: {
  bars: ChartBars[]; indicators: CandlestickIndicators; activeIndicators: Set<IndicatorKey>;
}) {
  const chronological = toChronological(bars);
  const data = chronological.map((b, i) => ({
    x: i, y: b.volume,
    backgroundColor: b.close >= b.open ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)',
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see PriceChart's own comment on this same pattern
  const datasets: any[] = [{ label: 'Volume', data }];
  if (activeIndicators.has('volumeMa')) {
    datasets.push({ type: 'line', label: 'Volume MA (20)', data: seriesToPoints(indicators.volumeSma20), borderColor: OVERLAY_COLORS.volumeMa, borderWidth: 1.5, pointRadius: 0 });
  }
  if (activeIndicators.has('obv')) {
    datasets.push({ type: 'line', label: 'OBV', data: seriesToPoints(indicators.obv), borderColor: OVERLAY_COLORS.obv, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' });
  }

  return (
    <div className="mb-3 h-24" data-testid="candlestick-volume-chart">
      <Chart
        type="bar"
        data={{ datasets }}
        options={{
          maintainAspectRatio: false,
          // No x tick labels here - the price chart directly above is this stack's one shared
          // axis (same convention as any candlestick+volume charting platform); giving
          // Volume/RSI/MACD's own independent Chart.js instance its own tick-selection pass
          // produced a real, live-found bug: inconsistent, out-of-order labels that didn't even
          // agree with the price chart's own, despite covering identical bars. The tooltip title
          // still resolves the real date on hover even though the axis itself stays unlabeled.
          scales: {
            x: { type: 'linear', ...indexAxisBounds(chronological), ticks: makeIndexAxisTicks(chronological, false) },
            y: { position: 'right', ticks: { callback: formatVolumeTick } },
            // OBV's own axis - its cumulative scale is unrelated to Volume's per-bar magnitude
            // (and can go negative, unlike raw volume), so it can't share the right-side axis.
            // Hidden unless OBV is actually toggled on, so it doesn't clutter the panel when
            // unused; no gridlines of its own to avoid a second overlapping grid.
            y1: { position: 'left', display: activeIndicators.has('obv'), ticks: { callback: formatVolumeTick }, grid: { drawOnChartArea: false } },
          },
          plugins: {
            legend: { display: activeIndicators.has('volumeMa') || activeIndicators.has('obv'), labels: { boxHeight: 6 } },
            tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } },
          },
        }}
      />
    </div>
  );
}

function RsiChart({ bars, rsi14 }: { bars: ChartBars[]; rsi14: (number | null)[] | null }) {
  const chronological = toChronological(bars);
  return (
    <div className="mb-3 h-32" data-testid="candlestick-rsi-chart">
      <Chart
        type="line"
        data={{ datasets: [{ label: 'RSI (14)', data: seriesToPoints(rsi14), borderColor: '#8b5cf6', borderWidth: 1.5, pointRadius: 0 }] }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ...indexAxisBounds(chronological), ticks: makeIndexAxisTicks(chronological, false) }, y: { position: 'right', min: 0, max: 100 } },
          plugins: { legend: { display: true, labels: { boxHeight: 6 } }, tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } } },
        }}
      />
    </div>
  );
}

function MacdChart({ bars, macd }: { bars: ChartBars[]; macd: ({ macd: number; signal: number; hist: number } | null)[] | null }) {
  const chronological = toChronological(bars);
  const macdLine = seriesToPoints(macd?.map((v) => (v ? v.macd : null)) ?? null);
  const signalLine = seriesToPoints(macd?.map((v) => (v ? v.signal : null)) ?? null);
  const histData = macd
    ? [...macd].reverse().map((v, i) => (v ? { x: i, y: v.hist, backgroundColor: v.hist >= 0 ? 'rgba(22,163,74,0.5)' : 'rgba(220,38,38,0.5)' } : null)).filter((p): p is { x: number; y: number; backgroundColor: string } => p != null)
    : [];

  return (
    <div className="mb-3 h-32" data-testid="candlestick-macd-chart">
      <Chart
        type="bar"
        data={{
          datasets: [
            { type: 'bar', label: 'Histogram', data: histData },
            { type: 'line', label: 'MACD', data: macdLine, borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0 },
            { type: 'line', label: 'Signal', data: signalLine, borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0 },
          ],
        }}
        options={{
          maintainAspectRatio: false,
          scales: { x: { type: 'linear', ...indexAxisBounds(chronological), ticks: makeIndexAxisTicks(chronological, false) }, y: { position: 'right' } },
          plugins: { legend: { display: true, labels: { boxHeight: 6 } }, tooltip: { callbacks: { title: makeTooltipTitleCallback(chronological) } } },
        }}
      />
    </div>
  );
}

// Marubozu/Belt Hold both need a badge variant computed from the matched bar's own direction
// (see CandlestickPatternBadge.tsx's own comment on why) - one shared helper instead of
// duplicating the same close-vs-open branch per pattern.
function directionVariant(pattern: CandlestickPatternKey, bar: ChartBars): { label: string; className: string } | undefined {
  const bullish = bar.close >= bar.open;
  if (pattern === 'marubozu') return bullish ? { label: 'M+', className: 'bg-green-600' } : { label: 'M-', className: 'bg-red-600' };
  if (pattern === 'beltHold') return bullish ? { label: 'B+', className: 'bg-green-600' } : { label: 'B-', className: 'bg-red-600' };
  return undefined;
}

// Pattern Detection panel (2026-09-26 POC, initially 1-Day only, expanded to every interval
// 2026-09-27) - a plain HTML badge strip, not another
// Chart.js instance, so badges stay real DOM nodes (testable, matches CategoryBadge's own
// title-tooltip idiom). Alignment with the price chart above comes from reading that chart's own
// Chart.js x-scale directly (via `priceChartRef`) rather than duplicating its scale config -
// `layoutTick` (bumped by the price chart's own afterRender hook) is the only thing that forces
// this component to re-render and recompute pixel positions after a resize.
function PatternPanel({ bars, visiblePatterns, priceChartRef, layoutTick }: {
  bars: ChartBars[];
  visiblePatterns: Set<CandlestickPatternKey>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own instance type, kept loose like the rest of this file's Chart.js interop
  priceChartRef: MutableRefObject<any>;
  layoutTick: number;
}) {
  const chronological = toChronological(bars);
  const matches = detectPatterns(chronological);
  const visibleMatches = matches.filter((m) => visiblePatterns.has(m.pattern));
  // Referenced only to force a re-render (and so a fresh pixel read) whenever the price chart's
  // own layout changes - the value itself isn't otherwise used.
  void layoutTick;

  // The connecting line (2026-09-26 follow-up) only ever shows for whichever single badge is
  // currently hovered - "an extension of the tooltip," not an always-on overlay. That constraint
  // is what keeps this simple: it never needs to know the hovered candle's actual pixel position
  // inside the price chart above, just a fixed-height line (matching PriceChart's own h-96)
  // reaching upward from the badge - no chart-internals pixel math beyond what badges already use.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    // 2 rows (2026-09-26, explicit direction - 8 patterns sharing 1 row was getting crowded):
    // Doji + its 3 sub-types on top (top: 25%), the remaining 4 patterns on the bottom
    // (top: 75%). Both rows are direct children of this SAME relative container (not two
    // separate <div> rows) specifically so every connector's `bottom-full` still resolves to
    // this container's own top edge regardless of which row its badge is in - splitting into two
    // stacked containers would otherwise mean the bottom row's connector needs a taller,
    // differently-computed height just to reach past the top row into the price chart above.
    // h-[42px] (not h-12, not h-16) is a second follow-up tightening pass, 2026-09-26 - the same
    // 25%/75% split against this exact height lands the two rows exactly 1px apart (each badge
    // is h-5/20px tall), per explicit "reduce the gap further to 1px" direction. An arbitrary
    // value is needed here since no standard Tailwind height class lands on the exact pixel math
    // (0.5*H - 20 = 1 => H = 42).
    // mb-px (not mb-3) - 2026-09-27 follow-up, explicit direction: the gap to the Complex
    // Patterns strip below should be 1px, matching this panel's own internal 25%/75% row
    // spacing rather than the ordinary 12px (mb-3) spacing used elsewhere on this page.
    <div className="relative mb-px h-[42px] w-full" data-testid="candlestick-pattern-panel">
      {visibleMatches.map((match) => {
        const bar = chronological[match.index];
        const left = priceChartRef.current?.scales?.x?.getPixelForValue(match.index) ?? 0;
        const detail = `O ${formatCurrency(bar.open)} · H ${formatCurrency(bar.high)} · L ${formatCurrency(bar.low)} · C ${formatCurrency(bar.close)}`;
        const top = DOJI_FAMILY_PATTERN_KEYS.includes(match.pattern) ? '25%' : '75%';
        return (
          <Fragment key={`${match.index}-${match.pattern}`}>
            {hoveredIndex === match.index && (
              <div
                data-testid="candlestick-pattern-connector"
                className="pointer-events-none absolute bottom-full z-10 h-96 w-px -translate-x-1/2 bg-accent"
                style={{ left: `${left}px` }}
              />
            )}
            <CandlestickPatternBadge
              pattern={match.pattern}
              detail={detail}
              // Marubozu/Belt Hold are the 2 patterns whose real bullish/bearish meaning depends
              // on this specific bar's own close-vs-open direction (unlike Hammer/Shooting Star,
              // whose interpretation is fixed regardless of the actual candle color) - the label
              // itself (M+/M-, B+/B-), not just the color, carries that distinction, so it's
              // colorblind-safe too. See CandlestickPatternBadge.tsx's own comment on why these
              // are the only 2 patterns that override their badge instead of using a fixed one.
              variant={directionVariant(match.pattern, bar)}
              style={{ left: `${left}px`, top, marginTop: '-10px' }}
              onMouseEnter={() => setHoveredIndex(match.index)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

// Multi-candle Pattern panel (2026-09-27, moved below the chart as its own strip after a second
// live-reported round of "the graph still jerks"). Originally rendered as an overlay directly on
// top of the price chart's own canvas, with a larger invisible hit-target wrapper added as a first
// fix attempt - that reduced but didn't eliminate the jerk, because the root cause was never
// really about hit-target size: ANY element living on top of an interactive Chart.js canvas, with
// the canvas still receiving events everywhere around it, puts our own hover state in permanent
// contention with Chart.js's own hover/tooltip system - a resting mouse tips between "our badge"
// and "the canvas underneath" no matter how the boundary is drawn, and both sides redraw something
// when it tips. Moving these panels below the chart entirely - each its own strip, structured like
// PatternPanel above - removes the competing interactive surface at the source rather than trying
// to out-tune it. One difference from PatternPanel: badges sit on a single centered row
// (`top: 50%`) instead of its 25%/75% split, since each strip carries only one pattern family (no
// Doji-style sub-split needed).
//
// Generalized 2026-09-27 (was hardcoded to the single Complex tier) so the same strip serves the
// Composite (2-candle), Advanced (3-candle), and Complex (5-candle, added 2026-10-03) tiers - the
// same generalize-rather-than-duplicate move PatternPicker below already went through when it
// gained its own second call site. All tiers are detected by the SAME detectComplexPatterns()
// pass; `visiblePatterns` is what decides which of its matches a given strip actually draws, so
// the tier split costs no extra detection work. `connectorHeightClass` differs per tier only
// because each strip sits a different distance below the price chart its connector has to reach
// back up into. `marginBottomClass` likewise differs per tier: every tier but the LAST one in the
// stack uses `mb-px` (the uniform 1px rhythm across all 5 lines), while whichever tier is
// currently last (Complex, since 2026-10-03 - previously Advanced) keeps the ordinary `mb-3` gap
// down to the Volume Chart, which sits outside that 5-line group.
function MultiCandlePatternPanel({ bars, visiblePatterns, priceChartRef, layoutTick, testIdPrefix, connectorHeightClass, marginBottomClass }: {
  bars: ChartBars[];
  visiblePatterns: Set<CandlestickPatternKey>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chart.js's own instance type, kept loose like the rest of this file's Chart.js interop
  priceChartRef: MutableRefObject<any>;
  layoutTick: number;
  testIdPrefix: string;
  connectorHeightClass: string;
  marginBottomClass: string;
}) {
  const chronological = toChronological(bars);
  const matches = detectComplexPatterns(chronological);
  const visibleMatches = matches.filter((m) => visiblePatterns.has(m.pattern));
  // Referenced only to force a re-render (and so a fresh pixel read) whenever the price chart's
  // own layout changes - the value itself isn't otherwise used.
  void layoutTick;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div className={`relative h-6 w-full ${marginBottomClass}`} data-testid={`${testIdPrefix}-overlay`}>
      {visibleMatches.map((match) => {
        const bar = chronological[match.index];
        const key = `${match.index}-${match.pattern}`;
        const left = priceChartRef.current?.scales?.x?.getPixelForValue(match.index) ?? 0;
        const detail = `O ${formatCurrency(bar.open)} · H ${formatCurrency(bar.high)} · L ${formatCurrency(bar.low)} · C ${formatCurrency(bar.close)}`;
        return (
          <Fragment key={key}>
            {hoveredKey === key && (
              <div
                data-testid={`${testIdPrefix}-connector`}
                className={`pointer-events-none absolute bottom-full z-10 ${connectorHeightClass} w-px -translate-x-1/2 bg-accent`}
                style={{ left: `${left}px` }}
              />
            )}
            <CandlestickPatternBadge
              pattern={match.pattern}
              detail={detail}
              style={{ left: `${left}px`, top: '50%', marginTop: '-10px' }}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

// Composite = 2-candle patterns, the 3rd line (renamed from "Complex" 2026-09-28 - see
// candlestickQuestionAnswer.service.ts's own ComplexityTier comment; internal identifiers here
// are unchanged, only the persisted/displayed tier name changed). Its own gap down to Advanced is
// mb-px (part of the uniform 1px rhythm across all 5 lines), so the connector reaching back up
// into the price chart recomputes to 428px: its own 1px gap to PatternPanel above + PatternPanel's
// 42px + the price chart's now-1px gap (was 12px mb-3) + the chart's own 384px.
function ComplexPatternPanel(props: Omit<Parameters<typeof MultiCandlePatternPanel>[0], 'testIdPrefix' | 'connectorHeightClass' | 'marginBottomClass'>) {
  return <MultiCandlePatternPanel {...props} testIdPrefix="candlestick-complex-pattern" connectorHeightClass="h-[428px]" marginBottomClass="mb-px" />;
}

// Advanced = 3-candle patterns, the 4th line. Connector adds ComplexPatternPanel's own 24px strip
// and its now-1px gap on top of Composite's 428px, so 453px total - same "close enough for a
// visual pointer" precision every connector here relies on, not pixel-exact. Its own gap down was
// mb-3 (the last line's gap to the Volume Chart) until the Complex tier was appended 2026-10-03 -
// now mb-px, since it's no longer the last line and needs the same uniform 1px rhythm as the rest
// of the group.
function AdvancedPatternPanel(props: Omit<Parameters<typeof MultiCandlePatternPanel>[0], 'testIdPrefix' | 'connectorHeightClass' | 'marginBottomClass'>) {
  return <MultiCandlePatternPanel {...props} testIdPrefix="candlestick-advanced-pattern" connectorHeightClass="h-[453px]" marginBottomClass="mb-px" />;
}

// Complex = 5-candle patterns (2026-10-03), the new 5th and last line - its own gap down to the
// Volume Chart is mb-3 (takes over Advanced's former role as the last line of the group). Connector
// adds AdvancedPatternPanel's own 24px strip and its now-1px gap on top of Advanced's 453px, so
// 478px total.
function Complex5PatternPanel(props: Omit<Parameters<typeof MultiCandlePatternPanel>[0], 'testIdPrefix' | 'connectorHeightClass' | 'marginBottomClass'>) {
  return <MultiCandlePatternPanel {...props} testIdPrefix="candlestick-complex5-pattern" connectorHeightClass="h-[478px]" marginBottomClass="mb-3" />;
}

// Floating icon+popover multi-select (2026-09-26) - combines two precedents from elsewhere in
// this codebase: the backdrop/positioning mechanics of CandlestickQuestionAnswerPage.tsx's own
// floating filter popover (a real bug was hit and fixed there when the wrapper div was missing
// `relative`, so it's included here from the start), with the checkbox/Set<T> toggle semantics of
// AdminCandlestickQuestionAnswerPage.tsx's horizon checkboxes - clicking a checkbox here toggles
// visibility only and does NOT close the popover, unlike that other page's single-select filter.
// Generalized 2026-09-27 (was hardcoded to PATTERN_KEYS) so the same floating icon+popover
// multi-select serves both the always-on simple-pattern picker and the new on-demand
// complex-pattern picker - `testIdPrefix` keeps their testids distinct so both can be present in
// the DOM (open or not) without id collisions.
function PatternPicker({ open, onToggleOpen, visible, onTogglePattern, onToggleAll, patternKeys, testIdPrefix }: {
  open: boolean;
  onToggleOpen: () => void;
  visible: Set<CandlestickPatternKey>;
  onTogglePattern: (key: CandlestickPatternKey) => void;
  // "All" checkbox at the top of the dropdown (2026-09-28, explicit direction) - a toggle just
  // like every per-pattern checkbox below it, not a one-way "select everything" action.
  onToggleAll: () => void;
  patternKeys: CandlestickPatternKey[];
  testIdPrefix: string;
}) {
  const allSelected = patternKeys.every((key) => visible.has(key));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        data-testid={`${testIdPrefix}-button`}
        className={`rounded-btn border px-2 py-1 text-xs font-medium transition-colors ${
          open ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:bg-bg-card'
        }`}
      >
        {visible.size} of {patternKeys.length} shown ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" data-testid={`${testIdPrefix}-backdrop`} onClick={onToggleOpen} />
          <div
            data-testid={`${testIdPrefix}-menu`}
            className="absolute left-0 top-full z-20 mt-1 w-40 rounded-btn border border-border bg-bg-card p-1.5 shadow-card"
          >
            <label
              data-testid={`${testIdPrefix}-option-all`}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs font-semibold text-text-primary hover:bg-bg-primary"
            >
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
              All
            </label>
            <div className="my-1 border-t border-border" aria-hidden="true" />
            {patternKeys.map((key) => (
              <label
                key={key}
                data-testid={`${testIdPrefix}-option-${key}`}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-text-primary hover:bg-bg-primary"
              >
                <input type="checkbox" checked={visible.has(key)} onChange={() => onTogglePattern(key)} />
                {PATTERN_LABELS[key]}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// In-popup symbol switcher (2026-09-28) - replaces the header's static ticker text so a user can
// switch which symbol this same popup shows without closing it. Mirrors PatternPicker's own
// backdrop/menu mechanics above, and reuses CandlestickSymbolList.tsx's own new-symbol-lookup form
// and cached-symbol row styling exactly (copied, not cross-file-extracted - this file already
// keeps its floating-popover pieces self-contained rather than sharing components across files).
// Deliberately calls useCachedSymbolsList() itself rather than threading the list down as a prop -
// react-query dedupes the identical query key against CandlestickSymbolList's own subscription
// when both are mounted, so this costs no extra network request. Selecting a symbol (row click or
// new-symbol submit) never touches `interval` - per explicit direction, only CandlestickPopup's
// own handleSelectSymbol changes `activeSymbol`, leaving interval/indicators/pattern picks alone.
function SymbolSwitcher({ activeSymbol, open, onToggleOpen, onSelectSymbol }: {
  activeSymbol: string;
  open: boolean;
  onToggleOpen: () => void;
  onSelectSymbol: (symbol: string) => void;
}) {
  const { data } = useCachedSymbolsList();
  const [newSymbolInput, setNewSymbolInput] = useState('');

  function handleNewSymbolSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newSymbolInput.trim().toUpperCase();
    if (!trimmed) return;
    onSelectSymbol(trimmed);
    setNewSymbolInput('');
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        data-testid="candlestick-symbol-switcher-button"
        className={`rounded-btn border px-2 py-1 text-lg font-semibold transition-colors ${
          open ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-text-primary hover:bg-bg-card'
        }`}
      >
        {activeSymbol} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" data-testid="candlestick-symbol-switcher-backdrop" onClick={onToggleOpen} />
          <div
            data-testid="candlestick-symbol-switcher-menu"
            className="absolute left-0 top-full z-20 mt-1 w-64 rounded-btn border border-border bg-bg-card p-2 text-sm font-normal shadow-card"
          >
            <form onSubmit={handleNewSymbolSubmit} className="mb-2 flex gap-1.5">
              <input
                value={newSymbolInput}
                onChange={(e) => setNewSymbolInput(e.target.value.toUpperCase())}
                placeholder="New symbol…"
                maxLength={10}
                data-testid="candlestick-symbol-switcher-new-symbol-input"
                className="min-w-0 flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm uppercase tracking-wide text-text-primary"
              />
              <button
                type="submit"
                disabled={!newSymbolInput.trim()}
                data-testid="candlestick-symbol-switcher-new-symbol-go"
                className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                Go
              </button>
            </form>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {data?.symbols?.length === 0 && (
                <p className="text-xs text-text-secondary" data-testid="candlestick-symbol-switcher-empty">
                  No symbols cached yet — look one up above.
                </p>
              )}
              {data?.symbols?.map((s) => (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => onSelectSymbol(s.symbol)}
                  data-testid={`candlestick-symbol-switcher-row-${s.symbol}`}
                  className={`block w-full rounded-btn px-2 py-1.5 text-left text-sm transition-colors hover:opacity-80 ${
                    s.isFresh ? 'bg-success/10 text-success' : 'bg-border text-text-secondary'
                  }`}
                >
                  <span className="font-semibold">{s.symbol}</span>
                  <span className="ml-2 text-xs opacity-80">{formatAsOf(s.updatedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
