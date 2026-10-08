import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSearchCuratedEntries, useAskCandlestickQuestion, useTopQuestions, CATEGORIES, COMPLEXITY_TIERS,
  type Category, type ComplexityTier, type AskHorizon, type MatchedPatternWithHorizonRelevance,
} from '../api/candlestickQuestionAnswer';
import { useSession } from '../api/auth';
import { ApiError } from '../api/client';
import CandlestickPatternDiagram from '../components/CandlestickPatternDiagram';
import { hasPatternDiagram } from '../lib/candlestickPatternDiagrams';
import CategoryBadge from '../components/CategoryBadge';

// 'all' appended last (2026-10-08) - a broader, less-specific choice than picking one of the 3
// real horizons, same ordering rationale as it being the last tab in a filter list elsewhere in
// this app. Horizon stopped excluding patterns from an answer this same round - it's purely
// informational now, driving the colored relevance badges below instead.
const HORIZON_LABELS: Record<AskHorizon, string> = {
  dayTrading: 'Day-Trading', mediumTerm: 'Swing Trading', longTerm: 'Long-Term Investment', all: 'All',
};

// Candlestick Pattern Q&A (Phase 1) - two independent ways to get an answer, per explicit
// direction: browse an already-curated question (instant, zero LLM cost) or ask a free-text
// question (goes through the backend's LLM function-calling loop, gated by its own dedicated
// rate limit). Not a top-level nav tab (moved 2026-09-21) - reachable via the "Pattern Q&A" link
// inside CandlestickSymbolList (Stock Analysis tab) or the shortcut inside CandlestickPopup.tsx.
export default function CandlestickQuestionAnswerPage() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  // Whether to send "Back" straight to Candlestick Charts (2026-10-07) - only when the session
  // actually holds stock_analysis:view, since an ask-only session (candlestick_question_answer
  // :ask without stock_analysis:view, the exact gap Stock Analysis's popover entry point was
  // built for) has no Charts page to go back to at all.
  const canStockAnalysis = session?.permissions?.includes('stock_analysis:view') ?? false;
  const [browseSearch, setBrowseSearch] = useState('');
  // Tracks which entry's answer is expanded inline, directly under its own question - not a
  // separate "selected answer" block at the bottom of the list (2026-09-21, explicit direction).
  // Clicking the already-open question again collapses it back.
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const { data: browseData, isLoading: browseLoading } = useSearchCuratedEntries({ query: browseSearch || undefined });

  // Column filters (2026-09-26, explicit direction) - single-select, client-side, layered on top
  // of the search box above (which already narrows the server-returned set). '' means "All".
  const [patternFilter, setPatternFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('');
  // Complexity (2026-09-27) - how many candles the pattern takes to read (Simple 1 / Complex 2 /
  // Advanced 3), the same tier the chart's own pattern pickers split on. A sophistication filter
  // for a self-directed-investing audience whose experience varies widely.
  const [complexityFilter, setComplexityFilter] = useState<ComplexityTier | ''>('');
  // Which column's filter menu is open, if any (2026-09-26 follow-up) - a floating popover
  // triggered by a small icon button instead of an inline <select>, so the header cell (and so
  // the whole column, table layout being auto-width) only needs to be as wide as the icon
  // itself, not the widest option string. The popover is position:absolute, so it never affects
  // the column's own width even while open.
  const [openFilter, setOpenFilter] = useState<'pattern' | 'complexity' | 'category' | null>(null);

  // Filter options only ever list values actually present in the current (already-searched) data
  // - picking a pattern/category that the search has already excluded would be a dead end.
  const patternOptions = useMemo(
    () => [...new Set(browseData?.entries.map((e) => e.patternName) ?? [])].sort(),
    [browseData],
  );
  const categoryOptions = useMemo(() => {
    const present = new Set(browseData?.entries.map((e) => e.category) ?? []);
    return CATEGORIES.filter((c) => present.has(c)); // keeps the fixed Definition -> ... order
  }, [browseData]);
  const complexityOptions = useMemo(() => {
    const present = new Set(browseData?.entries.map((e) => e.complexityTier) ?? []);
    return COMPLEXITY_TIERS.filter((t) => present.has(t)); // keeps the fixed Simple -> Advanced order
  }, [browseData]);

  const filteredEntries = useMemo(
    () => (browseData?.entries ?? []).filter(
      (e) => (!patternFilter || e.patternName === patternFilter)
        && (!complexityFilter || e.complexityTier === complexityFilter)
        && (!categoryFilter || e.category === categoryFilter),
    ),
    [browseData, patternFilter, complexityFilter, categoryFilter],
  );

  const [question, setQuestion] = useState('');
  const [horizon, setHorizon] = useState<AskHorizon>('dayTrading');
  const ask = useAskCandlestickQuestion();

  // Popular Questions (Phase 2, 2026-10-05) - reads the already-fetched answerText/
  // matchedPatternNames straight off the Top Questions cache row, same "no second request on
  // click" precedent as Browse Curated Questions' own inline expand above.
  const { data: topQuestionsData, isLoading: topQuestionsLoading } = useTopQuestions();
  const topQuestions = topQuestionsData?.questions ?? [];
  const [expandedTopQuestion, setExpandedTopQuestion] = useState<number | null>(null);

  function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    ask.mutate({ question: question.trim(), horizon });
  }

  return (
    <main className="flex flex-col gap-4 p-4 sm:p-6">
      {/* Back link - a direct "← Charts" link to /stock-analysis when the session can actually
          reach it (2026-10-07, explicit direction), since that's a predictable destination
          rather than whatever happens to be in browser history. Falls back to generic
          history-back for an ask-only session with no Charts access at all. Same hyperlink
          styling as CandlestickPopup.tsx's own Back/Ask-about-patterns links, for visual
          consistency across this feature. */}
      <button
        type="button"
        onClick={() => (canStockAnalysis ? navigate('/stock-analysis') : navigate(-1))}
        data-testid="candlestick-qa-back"
        className="self-start text-sm font-medium text-accent underline decoration-accent/50 underline-offset-2 transition-colors hover:text-accent-hover hover:decoration-accent"
      >
        {canStockAnalysis ? '← Charts' : '← Back'}
      </button>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="flex-1 rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="text-base font-semibold text-text-primary">Browse Curated Questions</h2>
          <p className="mt-1 text-xs text-text-muted">
            Common candlestick-pattern questions, already answered - instant, no cost.
          </p>
          <input
            value={browseSearch}
            onChange={(e) => setBrowseSearch(e.target.value)}
            placeholder="Search by pattern or keyword…"
            data-testid="candlestick-qa-browse-search"
            className="mt-3 w-full rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
          />
          {browseLoading && <p className="mt-3 text-sm text-text-secondary">Loading…</p>}
          {!browseLoading && browseData?.entries.length === 0 && (
            <p className="mt-3 text-sm text-text-secondary">No curated questions found{browseSearch ? ' matching that search' : ''}.</p>
          )}
          {!browseLoading && browseData && browseData.entries.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    {/* Pattern's column is sized to fit the longest pattern name on one line
                        (whitespace-nowrap on its <td> below), not squeezed to icon-width - a
                        table's auto layout sizes each column to its widest cell, header or body,
                        so without that the column would otherwise be free to shrink and wrap a
                        long name like "Three White Soldiers" across two lines. The filter itself
                        is still the same floating popover as Category (position:absolute, so its
                        own width never counts toward the column's). */}
                    <th className="whitespace-nowrap py-1.5 pr-3 align-top font-medium">
                      <div className="relative flex items-center gap-1">
                        <span>Pattern</span>
                        <button
                          type="button"
                          onClick={() => setOpenFilter((prev) => (prev === 'pattern' ? null : 'pattern'))}
                          data-testid="candlestick-qa-pattern-filter"
                          title="Filter by pattern"
                          className={`relative z-20 rounded p-0.5 ${patternFilter ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                        >
                          <FilterIcon />
                        </button>
                        {openFilter === 'pattern' && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenFilter(null)} />
                            <div
                              data-testid="candlestick-qa-pattern-filter-menu"
                              className="absolute left-0 top-full z-20 mt-1 max-h-56 w-max min-w-40 max-w-64 overflow-y-auto rounded-btn border border-border bg-bg-card p-1 text-left font-normal text-text-primary shadow-card"
                            >
                              <FilterOption label="All" selected={!patternFilter} onClick={() => { setPatternFilter(''); setOpenFilter(null); }} />
                              {patternOptions.map((p) => (
                                <FilterOption key={p} label={p} selected={patternFilter === p} onClick={() => { setPatternFilter(p); setOpenFilter(null); }} />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </th>
                    {/* Complexity (2026-09-27) - how many candles the pattern takes to read,
                        the same Simple/Complex/Advanced tier the chart's own pattern pickers
                        split on. Same floating-popover idiom as Pattern/Category either side of
                        it; squeezed to icon-width like Category since its body cell is only ever
                        one short word. */}
                    <th className="w-px whitespace-nowrap py-1.5 pr-3 align-top font-medium">
                      <div className="relative flex items-center gap-1">
                        <span>Complexity</span>
                        <button
                          type="button"
                          onClick={() => setOpenFilter((prev) => (prev === 'complexity' ? null : 'complexity'))}
                          data-testid="candlestick-qa-complexity-filter"
                          title="Filter by complexity"
                          className={`relative z-20 rounded p-0.5 ${complexityFilter ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                        >
                          <FilterIcon />
                        </button>
                        {openFilter === 'complexity' && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenFilter(null)} />
                            <div
                              data-testid="candlestick-qa-complexity-filter-menu"
                              className="absolute left-0 top-full z-20 mt-1 max-h-56 w-36 overflow-y-auto rounded-btn border border-border bg-bg-card p-1 text-left font-normal text-text-primary shadow-card"
                            >
                              <FilterOption label="All" selected={!complexityFilter} onClick={() => { setComplexityFilter(''); setOpenFilter(null); }} />
                              {complexityOptions.map((t) => (
                                <FilterOption key={t} label={t} selected={complexityFilter === t} onClick={() => { setComplexityFilter(t); setOpenFilter(null); }} />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </th>
                    {/* Category's own column stays squeezed to icon-width - its body cell is
                        just the small CategoryBadge, so there's no long content forcing it
                        wider the way Pattern's names do. */}
                    <th className="w-px whitespace-nowrap py-1.5 pr-3 align-top font-medium">
                      <div className="relative flex items-center gap-1">
                        <span>Category</span>
                        <button
                          type="button"
                          onClick={() => setOpenFilter((prev) => (prev === 'category' ? null : 'category'))}
                          data-testid="candlestick-qa-category-filter"
                          title="Filter by category"
                          className={`relative z-20 rounded p-0.5 ${categoryFilter ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                        >
                          <FilterIcon />
                        </button>
                        {openFilter === 'category' && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenFilter(null)} />
                            <div
                              data-testid="candlestick-qa-category-filter-menu"
                              className="absolute left-0 top-full z-20 mt-1 max-h-56 w-36 overflow-y-auto rounded-btn border border-border bg-bg-card p-1 text-left font-normal text-text-primary shadow-card"
                            >
                              <FilterOption label="All" selected={!categoryFilter} onClick={() => { setCategoryFilter(''); setOpenFilter(null); }} />
                              {categoryOptions.map((c) => (
                                <FilterOption key={c} label={c} selected={categoryFilter === c} onClick={() => { setCategoryFilter(c); setOpenFilter(null); }} />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </th>
                    <th className="w-full py-1.5 align-top font-medium">Question</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-text-secondary">
                        No questions match the selected filters.
                      </td>
                    </tr>
                  )}
                  {filteredEntries.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id));
                          }
                        }}
                        data-testid={`candlestick-qa-entry-${entry.id}`}
                        className="cursor-pointer border-b border-border text-text-primary last:border-0 hover:bg-bg-primary"
                      >
                        <td className="whitespace-nowrap py-1.5 pr-3 font-medium">{entry.patternName}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-text-secondary">{entry.complexityTier}</td>
                        <td className="py-1.5 pr-3"><CategoryBadge category={entry.category} /></td>
                        <td className="py-1.5 text-text-secondary">{entry.questionText}</td>
                      </tr>
                      {expandedEntryId === entry.id && (
                        <tr className="border-b border-border last:border-0">
                          {/* colSpan spans all 3 columns so the answer reads as one wide column,
                              not split across Pattern/Category/Question - explicit direction. */}
                          <td colSpan={4} className="bg-bg-primary p-3">
                            <div className="flex items-start gap-3" data-testid="candlestick-qa-selected-answer">
                              {hasPatternDiagram(entry.patternName) && (
                                <div className="flex w-1/4 shrink-0 justify-center">
                                  <CandlestickPatternDiagram patternName={entry.patternName} />
                                </div>
                              )}
                              <p className="min-w-0 flex-1 text-sm text-text-secondary">{entry.answerText}</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Column 2 - Ask Your Own Question (the action) above Popular Questions (already-
            answered reads), per explicit direction (2026-10-07): the two-column layout stays,
            but Popular Questions moved from its own full-width row into this column instead of
            sitting beside Browse Curated Questions. */}
        <div className="flex flex-1 flex-col gap-6">
        <section className="rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="text-base font-semibold text-text-primary">Ask Your Own Question</h2>
          <p className="mt-1 text-xs text-text-muted">
            Not financial advice - candlestick pattern education only, answered from the platform's own curated content.
          </p>
          <form onSubmit={handleAsk} className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Trading Horizon
              <select
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as AskHorizon)}
                data-testid="candlestick-qa-horizon-select"
                className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              >
                {(Object.keys(HORIZON_LABELS) as AskHorizon[]).map((h) => (
                  <option key={h} value={h}>{HORIZON_LABELS[h]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. What does a Bullish Engulfing pattern mean for swing trading?"
                rows={3}
                data-testid="candlestick-qa-question-input"
                className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              />
            </label>
            <button
              type="submit"
              disabled={ask.isPending || !question.trim()}
              data-testid="candlestick-qa-ask-button"
              className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {ask.isPending ? 'Asking…' : 'Ask (uses 1 of your daily limit)'}
            </button>
          </form>

          {ask.isError && (
            <p className="mt-3 text-sm text-danger" data-testid="candlestick-qa-ask-error">
              {ask.error instanceof ApiError ? ask.error.message : 'Something went wrong - please try again.'}
            </p>
          )}

          {ask.isSuccess && ask.data.outcome === 'answered_from_kb' && (
            <div className="mt-3 rounded-card border border-border bg-bg-primary p-3" data-testid="candlestick-qa-answer">
              <div className="flex items-start gap-3">
                {ask.data.matchedPatterns.some((m) => hasPatternDiagram(m.patternName)) && (
                  <div className="flex w-1/4 shrink-0 flex-col items-center gap-2">
                    {ask.data.matchedPatterns.filter((m) => hasPatternDiagram(m.patternName)).map((m) => (
                      <CandlestickPatternDiagram key={m.patternName} patternName={m.patternName} />
                    ))}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-secondary">{ask.data.answer}</p>
                  <HorizonRelevanceBadges matches={ask.data.matchedPatterns} />
                </div>
              </div>
            </div>
          )}
          {ask.isSuccess && ask.data.outcome === 'unable_to_answer' && (
            <div className="mt-3 rounded-card border border-warning/40 bg-warning/10 p-3" data-testid="candlestick-qa-unable-to-answer">
              <p className="text-sm font-medium text-text-primary">Unable to answer this question yet.</p>
              {ask.data.reason && <p className="mt-1 text-xs text-text-secondary">{ask.data.reason}</p>}
            </div>
          )}
        </section>

        <section className="rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="text-base font-semibold text-text-primary">Popular Questions</h2>
          <p className="mt-1 text-xs text-text-muted">
            The most frequently asked questions across everyone - instant, already answered.
          </p>
          {topQuestionsLoading && <p className="mt-3 text-sm text-text-secondary">Loading…</p>}
          {!topQuestionsLoading && topQuestions.length === 0 && (
            <p className="mt-3 text-sm text-text-secondary">No questions asked yet.</p>
          )}
          {!topQuestionsLoading && topQuestions.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {topQuestions.map((q, i) => (
                <li key={`${q.questionText}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedTopQuestion((prev) => (prev === i ? null : i))}
                    data-testid={`candlestick-qa-top-question-${i}`}
                    className="flex w-full items-center justify-between gap-3 rounded-btn px-2 py-1.5 text-left text-sm text-text-primary hover:bg-bg-primary"
                  >
                    <span className="min-w-0 flex-1 truncate">{q.questionText}</span>
                    <span className="shrink-0 text-xs text-text-muted">{q.questionAskedCount}×</span>
                  </button>
                  {expandedTopQuestion === i && (
                    <div
                      className="mt-1 rounded-card bg-bg-primary p-3"
                      data-testid={`candlestick-qa-top-question-answer-${i}`}
                    >
                      <div className="flex items-start gap-3">
                        {q.matchedPatternNames.some((m) => hasPatternDiagram(m.patternName)) && (
                          <div className="flex w-1/4 shrink-0 flex-col items-center gap-2">
                            {q.matchedPatternNames.filter((m) => hasPatternDiagram(m.patternName)).map((m) => (
                              <CandlestickPatternDiagram key={m.patternName} patternName={m.patternName} />
                            ))}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text-secondary">{q.answerText}</p>
                          <HorizonRelevanceBadges matches={q.matchedPatternNames} />
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}

// Green when the matched pattern is relevant to the selected Trading Horizon, red when it isn't,
// neutral/muted when relevantForHorizon is null ("All" selected, or no data to compare against).
function HorizonRelevanceBadges({ matches }: { matches: MatchedPatternWithHorizonRelevance[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {matches.map((m) => (
        <span
          key={m.patternName}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            m.relevantForHorizon === true
              ? 'bg-success/10 text-success'
              : m.relevantForHorizon === false
                ? 'bg-danger/10 text-danger'
                : 'bg-text-muted/10 text-text-muted'
          }`}
        >
          {m.patternName}
        </span>
      ))}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7L3 4z" />
    </svg>
  );
}

function FilterOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs ${selected ? 'bg-accent/10 font-medium text-accent' : 'text-text-primary hover:bg-bg-primary'}`}
    >
      {label}
    </button>
  );
}
