-- Candlestick Pattern Q&A - slim the ask-event log down to its one remaining job, Phase 2
-- (2026-10-05). Everything this table used to carry for gap-analysis/content purposes
-- (question_text, horizon, tier, outcome, matched_entry_id, llm_call_details) now lives in
-- m_candlestick_asked_question (migration 056), which does that job better - it aggregates
-- across users (a cache hit from a different user still needs this table's own per-user,
-- per-event row for rate-limiting to mean anything), so it can never replace this table outright.
--
-- What's left - user_id + created_at - is exactly what candlestickQuestionAnswerRateLimit
-- .service.ts's checkRateLimit() already queries (COUNT(*) WHERE user_id = $1 AND created_at >
-- now() - window). That service needs no code change; it only ever touched these two columns.
--
-- Only the LLM-calling branch of the new resolution cascade writes a row here now (see
-- candlestickQuestionAnswer.controller.ts's rewritten askQuestion) - a cache hit or a
-- template-matched answer costs nothing real and must not consume a user's rate-limit budget, a
-- genuine behavior change from before this phase (where every ask, including unable_to_answer,
-- counted - because every ask used to call the LLM).
--
-- Since gap-analysis has moved to m_candlestick_asked_question (which has no TTL, same
-- open-ended-retention rationale the old log used to need), this table's only remaining purpose
-- is a short rolling rate-limit window - a 1-day TTL is far longer than any reasonably-configured
-- rate-limit window (default 10 minutes, admin-tunable) while still bounding the table's size.
-- First ALTER TABLE ... SET (ttl_expire_after = ...) in this repo - every existing TTL elsewhere
-- was set at CREATE TABLE time; CockroachDB supports altering it onto an existing table the same
-- way.
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN question_text;
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN horizon;
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN tier;
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN outcome;
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN matched_entry_id;
ALTER TABLE user_evt_candlestick_question_answer_log DROP COLUMN llm_call_details;

ALTER TABLE user_evt_candlestick_question_answer_log SET (ttl_expire_after = '1 day');
