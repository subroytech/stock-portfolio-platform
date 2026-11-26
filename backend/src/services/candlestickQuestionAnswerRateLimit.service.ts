// Candlestick Pattern Q&A - per-user rate limit on real (LLM-calling) free-text ask calls.
// A dedicated limiter, not folded into fmpRateLimit.service.ts, since this is a materially
// different real-dollar-cost resource (LLM tokens, not FMP/Finnhub calls). Only the LLM branch
// of the resolution cascade is rate-limited; the curated picker, a cache hit, and a
// template-matched answer are all free reads, same "reads stay free" precedent used everywhere
// else in this app.
//
// Unlike fmpRateLimit.service.ts (which sums real per-call values out of a JSONB column, since
// one row there can represent many real calls), this limiter simply COUNTS rows in the window -
// every row in user_evt_candlestick_question_answer_log represents exactly one real, billed LLM
// invocation. Phase 2 (2026-10-05) narrowed WHICH asks ever write a row here (see
// recordRateLimitedCall() below and candlestickQuestionAnswer.controller.ts's own cascade) and
// slimmed the table itself down to just (user_id, created_at) - migration 059 - since gap
// analysis/answer caching moved to m_candlestick_asked_question. This file's own query is
// unaffected either way; it only ever touched those two columns.

import { pool } from '../db/pool';
import { getConfigInt } from './configProperty.service';
import { getUserRoles } from './roles.service';

const DEFAULT_MAX_QUESTIONS = 10;
const DEFAULT_WINDOW_MINUTES = 10;
const EXEMPT_ROLES = ['admin', 'admin-master'];

export class CandlestickQuestionAnswerRateLimitExceededError extends Error {}

export interface RateLimitStatus {
  allowed: boolean;
  exempt: boolean;
  limit: number;
  windowMinutes: number;
  usedInWindow: number;
}

export async function checkRateLimit(userId: string): Promise<RateLimitStatus> {
  const roles = await getUserRoles(userId);
  if (roles.some((role) => EXEMPT_ROLES.includes(role))) {
    return { allowed: true, exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0 };
  }

  const [limit, windowMinutes] = await Promise.all([
    getConfigInt('candlestick_question_answer_max_questions_per_window', DEFAULT_MAX_QUESTIONS),
    getConfigInt('candlestick_question_answer_rate_limit_window_minutes', DEFAULT_WINDOW_MINUTES),
  ]);

  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM user_evt_candlestick_question_answer_log
     WHERE user_id = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [userId, windowMinutes],
  );
  const usedInWindow = Number(rows[0]?.count ?? 0);

  return { allowed: usedInWindow < limit, exempt: false, limit, windowMinutes, usedInWindow };
}

// Called only from the LLM branch of the resolution cascade - a cache hit or a template-matched
// answer must never reach here, since neither costs anything real to rate-limit against.
export async function recordRateLimitedCall(userId: string): Promise<void> {
  await pool.query('INSERT INTO user_evt_candlestick_question_answer_log (user_id) VALUES ($1)', [userId]);
}
