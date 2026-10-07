import { useState } from 'react';
import {
  usePatterns, useCreatePattern, useAllEntries, useCreateEntry, useSetEntryStatus,
  useTemplates, useCreateTemplate, useSetTemplateStatus,
  CATEGORIES, COMPLEXITY_TIERS, type Tier, type Category, type ComplexityTier, type ResponseMode,
} from '../api/candlestickQuestionAnswer';
import { ApiError } from '../api/client';
import type { HorizonId } from '../lib/candlestickIndicators';
import CategoryBadge from '../components/CategoryBadge';

const STATUS_STYLES: Record<string, string> = {
  'Pending Approval': 'bg-warning/10 text-warning',
  Approved: 'bg-success/10 text-success',
  Rejected: 'bg-danger/10 text-danger',
};

const RESPONSE_MODES: ResponseMode[] = ['single', 'list'];
const DEFAULT_FILTER_MAPPING_JSON = '{\n  "fixedFilters": {},\n  "groupFilters": { "1": "patternNameOrSynonym" }\n}';

const HORIZONS: HorizonId[] = ['dayTrading', 'mediumTerm', 'longTerm'];
// Matches the frontend's own HORIZON_LABELS elsewhere (CandlestickQuestionAnswerPage.tsx) - the
// column name itself stays dayTrading/mediumTerm/longTerm end to end; only the user-facing label
// says "Swing Trading".
const HORIZON_LABELS: Record<HorizonId, string> = {
  dayTrading: 'Day-Trading', mediumTerm: 'Swing Trading', longTerm: 'Long-Term Investment',
};
const TIERS: Tier[] = [101, 201, 301];

// Candlestick Pattern Q&A (Phase 1) admin content-management screen - create patterns and their
// curated Q&A entries directly (admin-authored content lands at 'Approved' immediately, per
// candlestickQuestionAnswer.service.ts's own default), and change an entry's status. Phase 1
// itself never produces a 'Pending Approval' row (that's Phase 2's future promotion flow), but
// this screen is built ready for it - the Approve/Reject actions already work on any entry.
export default function AdminCandlestickQuestionAnswerPage() {
  const { data: patternsData } = usePatterns();
  const { data: entriesData, isLoading: entriesLoading } = useAllEntries();
  const { data: templatesData, isLoading: templatesLoading } = useTemplates();
  const templates = templatesData?.templates ?? [];
  const createPattern = useCreatePattern();
  const createEntry = useCreateEntry();
  const setEntryStatus = useSetEntryStatus();
  const createTemplate = useCreateTemplate();
  const setTemplateStatus = useSetTemplateStatus();

  const [newPatternName, setNewPatternName] = useState('');
  const [newPatternDescription, setNewPatternDescription] = useState('');
  const [newPatternHorizons, setNewPatternHorizons] = useState<Set<HorizonId>>(new Set());
  // Defaults to Simple (the single-candle tier) rather than an empty "pick one" state - matches
  // the column's own DB default (migration 050) and mirrors how entryCategory/entryTier below
  // start on a real value instead of forcing a selection.
  const [newPatternComplexity, setNewPatternComplexity] = useState<ComplexityTier>('Simple');

  const [entryPatternId, setEntryPatternId] = useState('');
  const [entryCategory, setEntryCategory] = useState<Category>('Definition');
  const [entryTier, setEntryTier] = useState<Tier>(101);
  const [entryQuestion, setEntryQuestion] = useState('');
  const [entryAnswer, setEntryAnswer] = useState('');

  // Question Templates (Phase 2, 2026-10-05) - filterMapping is admin-authored raw JSON rather
  // than a dynamic capture-group-mapping form, matching the backend's own "a small declarative
  // DSL, not executable code" design (migration 057's comment) - keeping the UI as simple as the
  // underlying data shape, rather than building a bespoke regex-group editor for a feature with
  // only a handful of templates expected.
  const [newTemplateKey, setNewTemplateKey] = useState('');
  const [newTemplateRegex, setNewTemplateRegex] = useState('');
  const [newTemplateResponseMode, setNewTemplateResponseMode] = useState<ResponseMode>('single');
  const [newTemplateFilterMappingJson, setNewTemplateFilterMappingJson] = useState(DEFAULT_FILTER_MAPPING_JSON);
  const [newTemplateAnswer, setNewTemplateAnswer] = useState('');
  const [newTemplateJsonError, setNewTemplateJsonError] = useState<string | null>(null);

  function toggleNewPatternHorizon(horizon: HorizonId) {
    setNewPatternHorizons((prev) => {
      const next = new Set(prev);
      if (next.has(horizon)) next.delete(horizon); else next.add(horizon);
      return next;
    });
  }

  function handleCreatePattern(e: React.FormEvent) {
    e.preventDefault();
    if (!newPatternName.trim() || !newPatternDescription.trim() || newPatternHorizons.size === 0) return;
    createPattern.mutate(
      {
        patternName: newPatternName.trim(), formationDescription: newPatternDescription.trim(),
        relevantHorizons: [...newPatternHorizons], complexityTier: newPatternComplexity,
      },
      { onSuccess: () => { setNewPatternName(''); setNewPatternDescription(''); setNewPatternHorizons(new Set()); setNewPatternComplexity('Simple'); } },
    );
  }

  function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!entryPatternId || !entryQuestion.trim() || !entryAnswer.trim()) return;
    createEntry.mutate(
      { patternId: entryPatternId, category: entryCategory, tier: entryTier, questionText: entryQuestion.trim(), answerText: entryAnswer.trim() },
      { onSuccess: () => { setEntryQuestion(''); setEntryAnswer(''); } },
    );
  }

  function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTemplateKey.trim() || !newTemplateRegex.trim() || !newTemplateAnswer.trim()) return;
    let filterMapping;
    try {
      filterMapping = JSON.parse(newTemplateFilterMappingJson);
      setNewTemplateJsonError(null);
    } catch {
      setNewTemplateJsonError('filterMapping must be valid JSON.');
      return;
    }
    createTemplate.mutate(
      {
        templateKey: newTemplateKey.trim(), regexPattern: newTemplateRegex.trim(),
        responseMode: newTemplateResponseMode, filterMapping, answerTemplate: newTemplateAnswer.trim(),
      },
      {
        onSuccess: () => {
          setNewTemplateKey(''); setNewTemplateRegex(''); setNewTemplateResponseMode('single');
          setNewTemplateFilterMappingJson(DEFAULT_FILTER_MAPPING_JSON); setNewTemplateAnswer('');
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="text-base font-semibold text-text-primary">New Pattern</h2>
          <form onSubmit={handleCreatePattern} className="mt-3 flex flex-col gap-3">
            <input
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              placeholder="Pattern name (e.g. Doji)"
              data-testid="candlestick-qa-new-pattern-name"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            <textarea
              value={newPatternDescription}
              onChange={(e) => setNewPatternDescription(e.target.value)}
              placeholder="Formation description"
              rows={3}
              data-testid="candlestick-qa-new-pattern-description"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            {/* Relevant Horizons (migration 048) - which horizons this pattern makes sense for
                at all, e.g. a single-bar pattern like Doji doesn't carry much weight for a
                long-term investor. At least one is required - this drives searchEntries()'s own
                horizon filter server-side, an entry no longer carries its own horizon. */}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm text-text-secondary">Relevant Horizons</legend>
              <div className="flex gap-3">
                {HORIZONS.map((h) => (
                  <label key={h} className="flex items-center gap-1.5 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={newPatternHorizons.has(h)}
                      onChange={() => toggleNewPatternHorizon(h)}
                      data-testid={`candlestick-qa-new-pattern-horizon-${h}`}
                    />
                    {HORIZON_LABELS[h]}
                  </label>
                ))}
              </div>
            </fieldset>
            {/* Complexity (migration 050) - how many candles the pattern takes to identify:
                Simple = 1, Composite = 2, Advanced = 3. Drives both the Browse page's own
                Complexity filter and which on-demand picker the candlestick chart offers the
                pattern under. */}
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              Complexity
              <select
                value={newPatternComplexity}
                onChange={(e) => setNewPatternComplexity(e.target.value as ComplexityTier)}
                data-testid="candlestick-qa-new-pattern-complexity"
                className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              >
                {COMPLEXITY_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button
              type="submit"
              disabled={createPattern.isPending || newPatternHorizons.size === 0}
              data-testid="candlestick-qa-create-pattern-button"
              className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {createPattern.isPending ? 'Creating…' : 'Create Pattern'}
            </button>
            {createPattern.isError && (
              <p className="text-sm text-danger">{createPattern.error instanceof ApiError ? createPattern.error.message : 'Something went wrong.'}</p>
            )}
          </form>
        </section>

        <section className="rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="text-base font-semibold text-text-primary">New Q&amp;A Entry</h2>
          <form onSubmit={handleCreateEntry} className="mt-3 flex flex-col gap-3">
            <select
              value={entryPatternId}
              onChange={(e) => setEntryPatternId(e.target.value)}
              data-testid="candlestick-qa-entry-pattern-select"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            >
              <option value="">Select a pattern…</option>
              {patternsData?.patterns.map((p) => <option key={p.id} value={p.id}>{p.patternName}</option>)}
            </select>
            <div className="flex gap-2">
              <select
                value={entryCategory}
                onChange={(e) => setEntryCategory(e.target.value as Category)}
                data-testid="candlestick-qa-entry-category-select"
                className="flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={entryTier}
                onChange={(e) => setEntryTier(Number(e.target.value) as Tier)}
                data-testid="candlestick-qa-entry-tier-select"
                className="flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              >
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <input
              value={entryQuestion}
              onChange={(e) => setEntryQuestion(e.target.value)}
              placeholder="Question"
              data-testid="candlestick-qa-entry-question"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            <textarea
              value={entryAnswer}
              onChange={(e) => setEntryAnswer(e.target.value)}
              placeholder="Answer"
              rows={3}
              data-testid="candlestick-qa-entry-answer"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            <button
              type="submit"
              disabled={createEntry.isPending}
              data-testid="candlestick-qa-create-entry-button"
              className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {createEntry.isPending ? 'Creating…' : 'Create Entry'}
            </button>
            {createEntry.isError && (
              <p className="text-sm text-danger">{createEntry.error instanceof ApiError ? createEntry.error.message : 'Something went wrong.'}</p>
            )}
          </form>
        </section>
      </div>

      <section className="rounded-card bg-bg-card p-4 shadow-card">
        <h2 className="text-base font-semibold text-text-primary">All Entries</h2>
        {entriesLoading && <p className="mt-3 text-sm text-text-secondary">Loading…</p>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Pattern</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium">Tier</th>
                <th className="py-1.5 pr-3 font-medium">Question</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entriesData?.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0" data-testid={`candlestick-qa-admin-row-${entry.id}`}>
                  <td className="py-1.5 pr-3 text-text-primary">{entry.patternName}</td>
                  <td className="py-1.5 pr-3"><CategoryBadge category={entry.category} /></td>
                  <td className="py-1.5 pr-3 text-text-secondary">{entry.tier}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{entry.questionText}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[entry.status]}`}>{entry.status}</span>
                  </td>
                  <td className="py-1.5">
                    {entry.status === 'Pending Approval' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEntryStatus.mutate({ id: entry.id, status: 'Approved' })}
                          data-testid={`candlestick-qa-approve-${entry.id}`}
                          className="text-xs text-success hover:underline"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryStatus.mutate({ id: entry.id, status: 'Rejected' })}
                          data-testid={`candlestick-qa-reject-${entry.id}`}
                          className="text-xs text-danger hover:underline"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Question Templates (Phase 2, 2026-10-05) - the deterministic cascade's last resort for a
          role without candlestick_question_answer:llm_calling. New templates/phrasings can be
          added here without a deploy - see migration 057's own header for the filterMapping
          shape this form's JSON textarea expects. */}
      <section className="rounded-card bg-bg-card p-4 shadow-card">
        <h2 className="text-base font-semibold text-text-primary">Question Templates</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Recognized question shapes answered deterministically (no LLM) for roles without LLM-calling access.
        </p>
        <form onSubmit={handleCreateTemplate} className="mt-3 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              value={newTemplateKey}
              onChange={(e) => setNewTemplateKey(e.target.value)}
              placeholder="Template key (e.g. bias_lookup)"
              data-testid="candlestick-qa-new-template-key"
              className="flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            <select
              value={newTemplateResponseMode}
              onChange={(e) => setNewTemplateResponseMode(e.target.value as ResponseMode)}
              data-testid="candlestick-qa-new-template-response-mode"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            >
              {RESPONSE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <input
            value={newTemplateRegex}
            onChange={(e) => setNewTemplateRegex(e.target.value)}
            placeholder="Regex pattern (e.g. is (.+?) bullish or bearish\??$)"
            data-testid="candlestick-qa-new-template-regex"
            className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 font-mono text-sm text-text-primary"
          />
          <label className="flex flex-col gap-1 text-sm text-text-secondary">
            Filter mapping (JSON)
            <textarea
              value={newTemplateFilterMappingJson}
              onChange={(e) => setNewTemplateFilterMappingJson(e.target.value)}
              rows={4}
              data-testid="candlestick-qa-new-template-filter-mapping"
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary"
            />
          </label>
          {newTemplateJsonError && <p className="text-sm text-danger">{newTemplateJsonError}</p>}
          <input
            value={newTemplateAnswer}
            onChange={(e) => setNewTemplateAnswer(e.target.value)}
            placeholder="Answer template (e.g. {patternName} is {directionalBias}.)"
            data-testid="candlestick-qa-new-template-answer"
            className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
          />
          <button
            type="submit"
            disabled={createTemplate.isPending}
            data-testid="candlestick-qa-create-template-button"
            className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {createTemplate.isPending ? 'Creating…' : 'Create Template'}
          </button>
          {createTemplate.isError && (
            <p className="text-sm text-danger">{createTemplate.error instanceof ApiError ? createTemplate.error.message : 'Something went wrong.'}</p>
          )}
        </form>

        {templatesLoading && <p className="mt-3 text-sm text-text-secondary">Loading…</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Key</th>
                <th className="py-1.5 pr-3 font-medium">Regex</th>
                <th className="py-1.5 pr-3 font-medium">Mode</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0" data-testid={`candlestick-qa-template-row-${t.id}`}>
                  <td className="py-1.5 pr-3 text-text-primary">{t.templateKey}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-text-secondary">{t.regexPattern}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{t.responseMode}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.status === 'active' ? 'bg-success/10 text-success' : 'bg-text-muted/10 text-text-muted'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => setTemplateStatus.mutate({ id: t.id, status: t.status === 'active' ? 'inactive' : 'active' })}
                      data-testid={`candlestick-qa-template-toggle-${t.id}`}
                      className="text-xs text-accent hover:underline"
                    >
                      {t.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
