-- Candlestick Pattern Q&A - deterministic-first resolution cascade, Phase 2 (2026-10-05). One
-- row per distinct (normalized question, horizon) ever successfully or unsuccessfully resolved
-- via the free-text Ask path - doubles as the answer-reuse cache (a repeat ask of the same
-- question is served from here, never regenerated) AND the question-popularity/gap-analysis
-- source that previously lived in user_evt_candlestick_question_answer_log (see migration 059,
-- which slims that table down to just its rate-limiting job now that this table covers the rest).
--
-- Scoped per (normalized_question_text, horizon), not globally per question - the same question
-- under a different trading horizon may legitimately deserve a different cached answer, since
-- the underlying curated content itself is horizon-scoped (m_candlestick_pattern's own
-- is_day_trading/is_medium_term/is_long_term columns, migration 048).
--
-- question_status distinguishes 'Answered' (eligible for the public "Top 100 Questions" list)
-- from 'Unable_To_Answer' (admin gap-analysis only, no answer_text to show a user). A future
-- 'Promoted' status is anticipated but not created here - that's the job of a later admin
-- workflow turning a popular cached answer into a real m_candlestick_question_answer_entry row,
-- reusing that table's own source_question_answer_log_id pointer (already present in its schema,
-- added well before this table existed, specifically anticipating this).
--
-- normalized_question_text is lowercase/trimmed/trailing-punctuation-stripped (see
-- candlestickAskedQuestion.service.ts's normalizeQuestionText()) - a deliberately simple
-- normalization, not real semantic clustering. question_text keeps the original, as-typed
-- wording for display/audit; the normalized column is what the uniqueness constraint and all
-- lookups actually key on.
CREATE TABLE m_candlestick_asked_question (
  id SERIAL PRIMARY KEY,
  question_text TEXT NOT NULL,
  normalized_question_text TEXT NOT NULL,
  horizon VARCHAR(20) NOT NULL,
  answer_text TEXT,
  matched_pattern_names JSONB,
  question_status VARCHAR(20) NOT NULL, -- 'Answered' | 'Unable_To_Answer', app-validated
  question_asked_count INT8 NOT NULL DEFAULT 1,
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_candlestick_asked_question_normalized ON m_candlestick_asked_question (normalized_question_text, horizon);

-- Backs the "Top 100 Questions" query: WHERE question_status = 'Answered' ORDER BY
-- question_asked_count DESC LIMIT 100.
CREATE INDEX idx_candlestick_asked_question_status_count ON m_candlestick_asked_question (question_status, question_asked_count DESC);
