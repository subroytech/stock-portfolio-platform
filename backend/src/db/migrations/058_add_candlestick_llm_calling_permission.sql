-- Candlestick Pattern Q&A - LLM-calling permission, Phase 2 (2026-10-05). A child of the
-- existing candlestick_question_answer:ask permission (migration 047) - same parent/child
-- enforcement roles.service.ts already has generically (PERMISSION_REQUIRES, used today for
-- contrarian_finder:scan_history -> contrarian_finder:scan): a role can hold :ask without
-- :llm_calling (gets the cache + template-only resolution cascade), but can never hold
-- :llm_calling without :ask.
--
-- Granted to every role that currently holds :ask, preserving today's behavior at rollout -
-- until this migration, :ask was the ONLY gate and every holder already got the full LLM path by
-- default, so introducing a zero-default-grant child here would silently downgrade every existing
-- role the instant this ships. Same default-preserving precedent as portfolio_upload:legacy's
-- own rollout grant (migration 024).
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('candlestick_question_answer:llm_calling', 'Candlestick Q&A - LLM Calling',
   'Allows the free-text Ask path to call the LLM (the full ReAct search/reasoning loop) for this role, once the deterministic cache and question-template steps have both missed. Requires candlestick_question_answer:ask. A role without this permission still gets cache-hit and template-matched answers, just never a real LLM call.',
   'active');

INSERT INTO m_role_permissions (role_id, permission_key)
SELECT role_id, 'candlestick_question_answer:llm_calling'
FROM m_role_permissions
WHERE permission_key = 'candlestick_question_answer:ask';

-- The parent permission's own description is now stale - it described Ask as always
-- LLM-backed, which is no longer true now that a role can lack :llm_calling.
UPDATE m_function_master
SET description = 'View the Candlestick Pattern Q&A tab - browse curated pattern questions, or ask a free-text question, answered deterministically from a cache or question templates, or by an LLM if this role also holds candlestick_question_answer:llm_calling.'
WHERE permission_key = 'candlestick_question_answer:ask';
