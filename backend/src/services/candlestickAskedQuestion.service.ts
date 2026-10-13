// Candlestick Pattern Q&A - deterministic-first resolution cascade, Phase 2 (2026-10-05). The
// cache half of the cascade: every ask, successful or not, lands in m_candlestick_asked_question
// (migration 056), keyed per (normalized question, horizon). A repeat ask of the same question
// is served straight from here - the first stored answer always wins, never regenerated, per
// the Section 14 requirements doc's own explicit decision.

import { pool } from '../db/pool';
import type { Horizon } from './candlestickQuestionAnswer.service';

export type QuestionStatus = 'Answered' | 'Unable_To_Answer';

// Which path in the deterministic-first cascade actually resolved the question (2026-10-09) -
// 'none' is the final catch-all (no template matched, caller's role can't use the LLM) and only
// ever pairs with QuestionStatus 'Unable_To_Answer'. Nullable at the DB level for rows written
// before this existed - surfaced as-is (null), never guessed.
export type ResolvedVia = 'llm' | 'template' | 'none';

// A matched pattern plus whether it's actually relevant to the horizon the question was asked
// under (2026-10-08) - null when that horizon was 'all' (nothing to compare against). Computed
// once by the controller's enrichMatchedPatterns() at write time and replayed verbatim on every
// future cache hit, never recomputed - same "first answer wins" philosophy this whole cache
// already follows for answerText itself.
export interface MatchedPatternWithHorizonRelevance {
  patternName: string;
  relevantForHorizon: boolean | null;
}

export interface CachedAnswer {
  answerText: string | null;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  resolvedVia: ResolvedVia | null;
  // True only when the LLM answered from its own general knowledge rather than the curated
  // tools/content (2026-10-09) - always false for a template/none-resolved row.
  fromGeneralKnowledge: boolean;
  // Whichever horizon this row was ORIGINALLY written under (2026-10-10) - horizon no longer
  // participates in cache matching (see findCachedAnswer()'s own comment), but the caller still
  // needs this to decide whether matchedPatternNames's relevance badges (baked in at write time,
  // for that original horizon) are still valid for the CURRENT request's horizon, or need
  // recomputing fresh.
  horizon: Horizon;
}

export interface TopQuestion {
  id: string;
  questionText: string;
  answerText: string;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  questionAskedCount: number;
  lastAskedAt: string;
  resolvedVia: ResolvedVia | null;
  fromGeneralKnowledge: boolean;
}

// Deliberately simple - lowercase, trim, strip trailing ?/!/. - not real semantic clustering.
// Two differently-worded-but-equivalent questions ("What is a Hammer?" vs "what's a hammer")
// will still be treated as distinct cache entries; documented as a known v1 limitation.
export function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/[?!.]+$/, '');
}

// Looks up an existing cache row by normalized question text alone - horizon dropped out of
// this lookup 2026-10-10 (see migration 070's own header): it's purely informational now, no
// longer part of what makes two asks "the same question," so keying the cache on it was actively
// harmful (the same question re-asked under a different horizon used to miss the cache and cost
// a second real LLM call, confirmed live). On a hit, increments the counter and bumps
// last_asked_at, but returns the PRE-existing answer_text/matched_pattern_names - the cache is
// read-through, never regenerative, even on a hit. Also returns the row's own stored horizon so
// the caller can tell whether the stored matchedPatternNames's relevance badges (computed for
// THAT horizon at write time) are still valid for the current request, or need recomputing.
export async function findCachedAnswer(questionText: string): Promise<CachedAnswer | null> {
  const normalized = normalizeQuestionText(questionText);
  const { rows } = await pool.query<{
    answer_text: string | null; matched_pattern_names: MatchedPatternWithHorizonRelevance[] | null;
    resolved_via: ResolvedVia | null; from_general_knowledge: boolean; horizon: Horizon;
  }>(
    `UPDATE m_candlestick_asked_question
     SET question_asked_count = question_asked_count + 1, last_asked_at = now()
     WHERE normalized_question_text = $1 AND question_status = 'Answered'
     RETURNING answer_text, matched_pattern_names, resolved_via, from_general_knowledge, horizon`,
    [normalized],
  );
  if (!rows[0]) return null;
  return {
    answerText: rows[0].answer_text,
    matchedPatternNames: rows[0].matched_pattern_names ?? [],
    resolvedVia: rows[0].resolved_via,
    fromGeneralKnowledge: rows[0].from_general_knowledge,
    horizon: rows[0].horizon,
  };
}

// Writes the outcome of a fresh resolution (LLM or template) into the cache. findCachedAnswer()
// only ever treats an 'Answered' row as a hit, so an 'Unable_To_Answer' row keeps getting a
// fresh resolution attempt on every repeat ask (deliberately, per the Section 14 design - a
// failure gets another chance rather than being frozen forever). A real bug this exposed
// live (2026-10-10): a later retry that actually SUCCEEDED (e.g. after switching to a stronger
// model) still only bumped question_asked_count/last_asked_at on conflict - the fresh, genuinely
// better answer was silently discarded, and the row stayed frozen at Unable_To_Answer/null
// forever. Fixed: on conflict, if the EXISTING row isn't already 'Answered' and the NEW attempt
// is, the row is upgraded in place (question_text/horizon/answer_text/matched_pattern_names
// /question_status/resolved_via/from_general_knowledge all swap to the successful attempt's
// values) in addition to the count/timestamp bump every conflict already got. If the existing
// row is ALREADY 'Answered', the upgrade condition is false and nothing but count/timestamp
// changes - preserving "first SUCCESSFUL answer wins" (including the rare genuine race between
// two concurrent first-asks, where the loser must never clobber the winner's already-stored
// answer with a possibly-different one of its own).
export async function recordAskedQuestion(input: {
  questionText: string;
  horizon: Horizon;
  answerText: string | null;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  status: QuestionStatus;
  resolvedVia: ResolvedVia;
  fromGeneralKnowledge: boolean;
}): Promise<void> {
  const normalized = normalizeQuestionText(input.questionText);
  const upgrading = `m_candlestick_asked_question.question_status != 'Answered' AND EXCLUDED.question_status = 'Answered'`;
  await pool.query(
    `INSERT INTO m_candlestick_asked_question
       (question_text, normalized_question_text, horizon, answer_text, matched_pattern_names, question_status, resolved_via, from_general_knowledge)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (normalized_question_text)
     DO UPDATE SET
       question_asked_count = m_candlestick_asked_question.question_asked_count + 1,
       last_asked_at = now(),
       question_text = CASE WHEN ${upgrading} THEN EXCLUDED.question_text ELSE m_candlestick_asked_question.question_text END,
       horizon = CASE WHEN ${upgrading} THEN EXCLUDED.horizon ELSE m_candlestick_asked_question.horizon END,
       answer_text = CASE WHEN ${upgrading} THEN EXCLUDED.answer_text ELSE m_candlestick_asked_question.answer_text END,
       matched_pattern_names = CASE WHEN ${upgrading} THEN EXCLUDED.matched_pattern_names ELSE m_candlestick_asked_question.matched_pattern_names END,
       question_status = CASE WHEN ${upgrading} THEN EXCLUDED.question_status ELSE m_candlestick_asked_question.question_status END,
       resolved_via = CASE WHEN ${upgrading} THEN EXCLUDED.resolved_via ELSE m_candlestick_asked_question.resolved_via END,
       from_general_knowledge = CASE WHEN ${upgrading} THEN EXCLUDED.from_general_knowledge ELSE m_candlestick_asked_question.from_general_knowledge END`,
    [
      input.questionText, normalized, input.horizon, input.answerText,
      JSON.stringify(input.matchedPatternNames), input.status, input.resolvedVia, input.fromGeneralKnowledge,
    ],
  );
}

// Backs the frontend's "Popular Questions" list - full rows (including answer_text) so a click
// renders instantly with no second request, same "reads stay free" precedent used everywhere
// else in this app.
export async function listTopQuestions(limit = 100): Promise<TopQuestion[]> {
  const { rows } = await pool.query<{
    id: string; question_text: string; answer_text: string; matched_pattern_names: MatchedPatternWithHorizonRelevance[] | null;
    question_asked_count: string; last_asked_at: string; resolved_via: ResolvedVia | null; from_general_knowledge: boolean;
  }>(
    `SELECT id, question_text, answer_text, matched_pattern_names, question_asked_count, last_asked_at, resolved_via, from_general_knowledge
     FROM m_candlestick_asked_question
     WHERE question_status = 'Answered'
     ORDER BY question_asked_count DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    questionText: row.question_text,
    answerText: row.answer_text,
    matchedPatternNames: row.matched_pattern_names ?? [],
    questionAskedCount: Number(row.question_asked_count),
    lastAskedAt: row.last_asked_at,
    resolvedVia: row.resolved_via,
    fromGeneralKnowledge: row.from_general_knowledge,
  }));
}

// Backs the "Delete Historical Questions" permission's own control on the Popular Questions
// list - a direct, permanent delete of one cache row by id. Returns whether a row was actually
// deleted (false on an unknown id) so the controller can 404 instead of silently no-op-ing.
export async function deleteAskedQuestion(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM m_candlestick_asked_question WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
