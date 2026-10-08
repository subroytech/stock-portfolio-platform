// Candlestick Pattern Q&A - deterministic-first resolution cascade, Phase 2 (2026-10-05). The
// cache half of the cascade: every ask, successful or not, lands in m_candlestick_asked_question
// (migration 056), keyed per (normalized question, horizon). A repeat ask of the same question
// is served straight from here - the first stored answer always wins, never regenerated, per
// the Section 14 requirements doc's own explicit decision.

import { pool } from '../db/pool';
import type { Horizon } from './candlestickQuestionAnswer.service';

export type QuestionStatus = 'Answered' | 'Unable_To_Answer';

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
}

export interface TopQuestion {
  questionText: string;
  answerText: string;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  questionAskedCount: number;
  lastAskedAt: string;
}

// Deliberately simple - lowercase, trim, strip trailing ?/!/. - not real semantic clustering.
// Two differently-worded-but-equivalent questions ("What is a Hammer?" vs "what's a hammer")
// will still be treated as distinct cache entries; documented as a known v1 limitation.
export function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/[?!.]+$/, '');
}

// Looks up an existing cache row by (normalized question, horizon). On a hit, increments the
// counter and bumps last_asked_at, but returns the PRE-existing answer_text/matched_pattern_names
// - the cache is read-through, never regenerative, even on a hit.
export async function findCachedAnswer(questionText: string, horizon: Horizon): Promise<CachedAnswer | null> {
  const normalized = normalizeQuestionText(questionText);
  const { rows } = await pool.query<{ answer_text: string | null; matched_pattern_names: MatchedPatternWithHorizonRelevance[] | null }>(
    `UPDATE m_candlestick_asked_question
     SET question_asked_count = question_asked_count + 1, last_asked_at = now()
     WHERE normalized_question_text = $1 AND horizon = $2 AND question_status = 'Answered'
     RETURNING answer_text, matched_pattern_names`,
    [normalized, horizon],
  );
  if (!rows[0]) return null;
  return {
    answerText: rows[0].answer_text,
    matchedPatternNames: rows[0].matched_pattern_names ?? [],
  };
}

// Writes the outcome of a fresh resolution (LLM or template) into the cache. ON CONFLICT only
// ever fires on a genuine race between two concurrent first-asks of the same question - the
// normal path is findCachedAnswer() returning a hit before this is ever called again for that
// question.
export async function recordAskedQuestion(input: {
  questionText: string;
  horizon: Horizon;
  answerText: string | null;
  matchedPatternNames: MatchedPatternWithHorizonRelevance[];
  status: QuestionStatus;
}): Promise<void> {
  const normalized = normalizeQuestionText(input.questionText);
  await pool.query(
    `INSERT INTO m_candlestick_asked_question
       (question_text, normalized_question_text, horizon, answer_text, matched_pattern_names, question_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (normalized_question_text, horizon)
     DO UPDATE SET question_asked_count = m_candlestick_asked_question.question_asked_count + 1, last_asked_at = now()`,
    [
      input.questionText, normalized, input.horizon, input.answerText,
      JSON.stringify(input.matchedPatternNames), input.status,
    ],
  );
}

// Backs the frontend's "Popular Questions" list - full rows (including answer_text) so a click
// renders instantly with no second request, same "reads stay free" precedent used everywhere
// else in this app.
export async function listTopQuestions(limit = 100): Promise<TopQuestion[]> {
  const { rows } = await pool.query<{
    question_text: string; answer_text: string; matched_pattern_names: MatchedPatternWithHorizonRelevance[] | null;
    question_asked_count: string; last_asked_at: string;
  }>(
    `SELECT question_text, answer_text, matched_pattern_names, question_asked_count, last_asked_at
     FROM m_candlestick_asked_question
     WHERE question_status = 'Answered'
     ORDER BY question_asked_count DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    questionText: row.question_text,
    answerText: row.answer_text,
    matchedPatternNames: row.matched_pattern_names ?? [],
    questionAskedCount: Number(row.question_asked_count),
    lastAskedAt: row.last_asked_at,
  }));
}
