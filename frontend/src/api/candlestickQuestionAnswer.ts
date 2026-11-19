import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { HorizonId } from '../lib/candlestickIndicators';

export type Tier = 101 | 201 | 301;
// Fixed, difficulty-ordered sequence (2026-09-26) - Definition/Interpretation are tier 101;
// Reliability/How to Use/Common Mistakes are tier 201. Tier 301 is reserved for a later, separate
// kind of content (combining multiple patterns into one interpretation), not this axis. Matches
// backend/src/services/candlestickQuestionAnswer.service.ts's Category type exactly.
export type Category = 'Definition' | 'Interpretation' | 'Reliability' | 'How to Use' | 'Common Mistakes';
// The single canonical ordering, reused anywhere the full sequence needs to render (the Admin
// Console's category select, the Browse table's category filter) - one source of truth instead
// of the same array retyped in multiple files.
export const CATEGORIES: Category[] = ['Definition', 'Interpretation', 'Reliability', 'How to Use', 'Common Mistakes'];

// How many candles the pattern takes to identify (migration 050): Simple = 1, Composite = 2,
// Advanced = 3, Complex = 5 (2026-10-03). A structural property of the pattern itself, deliberately
// unrelated to Tier above (content depth within one pattern's Q&A). Matches the backend service's
// ComplexityTier exactly, same hand-maintained mirror convention as Category/Tier above. "Composite"
// was renamed from 'Complex' 2026-09-28 (migration 053); the 4th tier reuses that now-vacated name
// for genuinely 5-candle patterns (e.g. Rising/Falling Three Methods) - no DB migration was needed
// to add it, since complexity_tier has no CHECK constraint and 'Complex' already fits the column.
export type ComplexityTier = 'Simple' | 'Composite' | 'Advanced' | 'Complex';
// Canonical easiest-to-hardest ordering, reused wherever the full sequence renders (the Browse
// table's complexity filter, the Admin Console's complexity select) - same one-source-of-truth
// role CATEGORIES plays for its own axis.
export const COMPLEXITY_TIERS: ComplexityTier[] = ['Simple', 'Composite', 'Advanced', 'Complex'];

export interface QuestionAnswerEntry {
  id: string;
  patternId: string;
  patternName: string;
  // Denormalized from the entry's own pattern by the backend's ENTRY_SELECT join, so the Browse
  // table can filter by complexity without separately fetching the pattern list.
  complexityTier: ComplexityTier;
  category: Category;
  tier: Tier;
  questionText: string;
  answerText: string;
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pattern {
  id: string;
  patternName: string;
  formationDescription: string;
  status: 'active' | 'inactive';
  // Which horizons this pattern is relevant to (migration 048) - drives searchEntries()'s own
  // horizon filter server-side; a pattern with no entry-level horizon of its own anymore.
  relevantHorizons: HorizonId[];
  complexityTier: ComplexityTier;
  createdAt: string;
  updatedAt: string;
}

// A matched pattern plus whether it's actually relevant to the horizon the question was asked
// under (2026-10-08) - null when "All" was selected (nothing to compare against), so the
// frontend can render a neutral badge instead of green/red. Shared by AskResult and TopQuestion
// below, and by the Ask form's own popular-questions replay.
export interface MatchedPatternWithHorizonRelevance {
  patternName: string;
  relevantForHorizon: boolean | null;
}

export interface AskResult {
  outcome: 'answered_from_kb' | 'unable_to_answer';
  answer: string | null;
  matchedEntryIds: string[];
  matchedPatterns: MatchedPatternWithHorizonRelevance[];
  reason: string | null;
  // True only when the LLM answered from its own general knowledge, not the curated tools/
  // content (2026-10-09, the system prompt's loosened "never guess" rule) - the transparency
  // flag for that trade-off. Always false for a template-resolved or cached-from-such answer.
  fromGeneralKnowledge: boolean;
}

// Horizon stopped being an exclusionary filter anywhere in the Candlestick Tutorial feature
// (2026-10-08) - it's informational now, and "All" (no specific preference) is a real, selectable
// option. Deliberately its own type, scoped to this feature's Ask form only - NOT a widening of
// the shared HorizonId from ../lib/candlestickIndicators, which Candlestick Charts also depends
// on for an unrelated purpose (which indicators to show per timeframe).
export type AskHorizon = HorizonId | 'all';

// Which path in the deterministic-first cascade actually resolved the question (2026-10-09) -
// null for rows written before this existed, surfaced as-is, never guessed. 'none' (no template
// matched, caller's role can't use the LLM) only ever pairs with Unable_To_Answer, so it can
// never actually appear on a TopQuestion row (listTopQuestions is Answered-only) - kept in the
// union anyway since this type mirrors the backend's own ResolvedVia exactly.
export type ResolvedVia = 'llm' | 'template' | 'none' | null;

// Phase 2 (2026-10-05) - the deterministic-first resolution cascade's cache
// (m_candlestick_asked_question). answerText/matchedPatternNames are already included in the
// list response, same "reads stay free, no second request on click" precedent as everything
// else in this app that's a pure read.
export interface TopQuestion {
  // Backs the "Delete Historical Questions" control (2026-10-10) - lets a delete request target
  // the exact row, instead of relying on questionText (not guaranteed unique across horizons).
  id: string;
  questionText: string;
  answerText: string;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  questionAskedCount: number;
  lastAskedAt: string;
  resolvedVia: ResolvedVia;
  fromGeneralKnowledge: boolean;
}

export type ResponseMode = 'single' | 'list';

export interface QuestionTemplate {
  id: string;
  templateKey: string;
  regexPattern: string;
  responseMode: ResponseMode;
  filterMapping: { fixedFilters: Record<string, string | boolean>; groupFilters: Record<string, string> };
  answerTemplate: string;
  // Plain-English example question that would actually match regexPattern - backs the "(i)"
  // info popover on the Ask form (see useQuestionShapes below).
  examplePhrasing: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

// The curated picker's own search - a plain read, no LLM cost, so this stays a normal query
// (not tied to any rate-limit indicator the way the ask mutation is).
export function useSearchCuratedEntries(params: { query?: string; tier?: Tier } = {}, enabled = true) {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.tier) search.set('tier', String(params.tier));
  const qs = search.toString();

  return useQuery({
    queryKey: ['candlestickQuestionAnswerEntries', params],
    queryFn: () => apiFetch<{ entries: QuestionAnswerEntry[] }>(`/candlestick-question-answer/entries${qs ? `?${qs}` : ''}`),
    enabled,
  });
}

// The free-text ask path - the only action in this feature with a real LLM cost, gated by the
// dedicated candlestickQuestionAnswerRateLimit.service.ts on the backend.
export function useAskCandlestickQuestion() {
  return useMutation({
    mutationFn: ({ question, horizon }: { question: string; horizon: AskHorizon }) =>
      apiFetch<AskResult>('/candlestick-question-answer/ask', {
        method: 'POST',
        body: JSON.stringify({ question, horizon }),
      }),
  });
}

// --- Admin content management (candlestick_question_answer:manage_content) ---

export function usePatterns() {
  return useQuery({
    queryKey: ['candlestickQuestionAnswerPatterns'],
    queryFn: () => apiFetch<{ patterns: Pattern[] }>('/candlestick-question-answer/patterns'),
  });
}

export function useCreatePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { patternName: string; formationDescription: string; relevantHorizons: HorizonId[]; complexityTier: ComplexityTier }) =>
      apiFetch<{ pattern: Pattern }>('/candlestick-question-answer/patterns', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionAnswerPatterns'] }),
  });
}

export function useAllEntries() {
  return useQuery({
    queryKey: ['candlestickQuestionAnswerAllEntries'],
    queryFn: () => apiFetch<{ entries: QuestionAnswerEntry[] }>('/candlestick-question-answer/admin/entries'),
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { patternId: string; category: Category; tier: Tier; questionText: string; answerText: string }) =>
      apiFetch<{ entry: QuestionAnswerEntry }>('/candlestick-question-answer/entries', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionAnswerAllEntries'] }),
  });
}

export function useSetEntryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'Approved' | 'Rejected' }) =>
      apiFetch<{ success: true }>(`/candlestick-question-answer/entries/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionAnswerAllEntries'] }),
  });
}

// --- Popular Questions (Phase 2, 2026-10-05) - a plain read, same candlestick_question_answer
// :ask gate as the curated picker above, no LLM cost. ---

export function useTopQuestions() {
  return useQuery({
    queryKey: ['candlestickQuestionAnswerTopQuestions'],
    queryFn: () => apiFetch<{ questions: TopQuestion[] }>('/candlestick-question-answer/top-questions'),
  });
}

// "Delete Historical Questions" (candlestick_question_answer:delete_history, 2026-10-10) - a
// real action, separately permissioned from the free read above.
export function useDeleteTopQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: true }>(`/candlestick-question-answer/top-questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionAnswerTopQuestions'] }),
  });
}

// --- Question Templates admin management (candlestick_question_answer:manage_content, Phase 2) ---

export function useTemplates() {
  return useQuery({
    queryKey: ['candlestickQuestionTemplates'],
    queryFn: () => apiFetch<{ templates: QuestionTemplate[] }>('/candlestick-question-answer/templates'),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { templateKey: string; regexPattern: string; responseMode: ResponseMode; filterMapping: QuestionTemplate['filterMapping']; answerTemplate: string; examplePhrasing: string }) =>
      apiFetch<{ template: QuestionTemplate }>('/candlestick-question-answer/templates', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionTemplates'] }),
  });
}

// --- "(i)" info popover (candlestick_question_answer:ask, 2026-10-08) ---

// A plain read backing the Ask form's "(i)" popover - every active template's example phrasing,
// so a role without :llm_calling can discover recognized question shapes instead of guessing.
export function useQuestionShapes() {
  return useQuery({
    queryKey: ['candlestickQuestionShapes'],
    queryFn: () => apiFetch<{ examples: string[] }>('/candlestick-question-answer/question-shapes'),
  });
}

export function useSetTemplateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      apiFetch<{ success: true }>(`/candlestick-question-answer/templates/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candlestickQuestionTemplates'] }),
  });
}
