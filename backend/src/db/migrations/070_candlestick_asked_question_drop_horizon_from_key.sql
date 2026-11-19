-- Candlestick Pattern Q&A - drops horizon from the asked-question cache's uniqueness/lookup key
-- (2026-10-10). Horizon stopped being exclusionary anywhere in this feature back on 2026-10-08
-- (migration/build round "Candlestick Tutorial - Horizon Becomes Informational") - it's purely
-- informational now (drives per-pattern relevance badges, nothing else), so the underlying
-- ANSWER to a given question no longer actually depends on which horizon was selected when it
-- was asked. Keying the cache on (normalized_question_text, horizon) was therefore actively
-- harmful, not just redundant: a live-reported bug confirmed it directly - the exact same
-- question, re-asked after the Ask form's own default horizon changed from "Day Trading" to
-- "All" (an unrelated UI change the same day), produced a brand-new cache row and a second real
-- LLM call instead of being recognized as a repeat.
--
-- horizon stays as a column on the table - still recorded at write time for audit/display - it
-- just no longer participates in the UNIQUE index. The matching service-layer and controller
-- changes (findCachedAnswer()/recordAskedQuestion() dropping horizon from their WHERE/ON CONFLICT
-- clauses, and the controller re-enriching matchedPatternNames's relevance badges fresh whenever
-- a cache hit's originally-stored horizon differs from the current request's) ship in the same
-- commit as this migration - see candlestickAskedQuestion.service.ts and
-- candlestickQuestionAnswer.controller.ts.
--
-- Data cleanup first, required before the new UNIQUE index below can even be created: this exact
-- bug already produced one real duplicate pair in this dev DB (same question, two rows, one per
-- horizon). For each group of rows sharing a normalized_question_text, keep a single survivor
-- (preferring a real 'Answered' row over 'Unable_To_Answer', then the most recently asked),
-- summing the group's total question_asked_count onto it, then delete every other row in the
-- group. A complete no-op for any environment with no such duplicates - the "winner" subquery
-- simply resolves to the row's own id when it has no duplicates to begin with.
UPDATE m_candlestick_asked_question q
SET question_asked_count = (
  SELECT SUM(q2.question_asked_count) FROM m_candlestick_asked_question q2
  WHERE q2.normalized_question_text = q.normalized_question_text
)
WHERE q.id = (
  SELECT q3.id FROM m_candlestick_asked_question q3
  WHERE q3.normalized_question_text = q.normalized_question_text
  ORDER BY (q3.question_status = 'Answered') DESC, q3.last_asked_at DESC
  LIMIT 1
);

DELETE FROM m_candlestick_asked_question q
WHERE q.id != (
  SELECT q2.id FROM m_candlestick_asked_question q2
  WHERE q2.normalized_question_text = q.normalized_question_text
  ORDER BY (q2.question_status = 'Answered') DESC, q2.last_asked_at DESC
  LIMIT 1
);

DROP INDEX idx_candlestick_asked_question_normalized;
CREATE UNIQUE INDEX idx_candlestick_asked_question_normalized ON m_candlestick_asked_question (normalized_question_text);
