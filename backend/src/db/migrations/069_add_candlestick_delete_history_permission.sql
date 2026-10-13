-- Candlestick Pattern Q&A - "Delete Historical Questions" (2026-10-10), a new Function letting a
-- role delete individual rows from the Popular Questions history (m_candlestick_asked_question)
-- directly from that page. A child permission of candlestick_question_answer:ask via the
-- existing generic PERMISSION_REQUIRES mechanism (roles.service.ts) - Popular Questions only
-- exists for a role that already holds :ask, same precedent as :llm_calling's own relationship
-- to :ask. Zero default grants, same "Admin or Admin-Master can grant it to any role via the
-- normal Manage Permission screen" precedent as contrarian_finder:view_history/usage_audit:view
-- (migrations 036/040) - not added to roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('candlestick_question_answer:delete_history', 'Delete Historical Questions',
   'Delete individual rows from the Popular Questions history (the deterministic-first cascade''s '
   || 'answer cache) directly from the Candlestick Pattern Q&A page. Requires candlestick_question_answer:ask.',
   'active');
