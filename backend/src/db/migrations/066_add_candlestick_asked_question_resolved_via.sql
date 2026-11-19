-- Candlestick Pattern Q&A - tracks which path in the deterministic-first cascade actually
-- resolved a question (2026-10-09), surfaced as an "LLM" vs "Template" indicator on the
-- Popular Questions list. Nullable - rows written before this shipped have no value and are
-- treated as unknown, not backfilled (there's no reliable way to infer it after the fact).
--
-- Values (app-validated, not a CHECK constraint, same convention as question_status on this
-- same table): 'llm', 'template', 'none' (the final catch-all - no template matched and the
-- caller's role can't use the LLM - always paired with question_status = 'Unable_To_Answer',
-- so it can never appear in listTopQuestions()'s own Answered-only result set).
ALTER TABLE m_candlestick_asked_question ADD COLUMN resolved_via VARCHAR(20);
