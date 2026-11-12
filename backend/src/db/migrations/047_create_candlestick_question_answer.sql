-- Candlestick Pattern Q&A (Phase 1) - CLAUDE.md/Architecture.md have the full narrative.
-- A curated candlestick-PATTERN (Doji/Hammer/Engulfing/etc.) knowledge base, distinct from the
-- already-shipped Candlestick Quick Reference's indicator-relevance content. Two ways to get an
-- answer: browse an already-curated question (instant, direct DB read, this migration's own
-- seed content via a separate npm run seed:candlestick-question-answer script) or ask a
-- free-text question, answered by an LLM via function-calling strictly against this same
-- curated DB - falling through to an honest "unable to answer" rather than a guess.
--
-- m_ prefix for the pattern catalog and its Q&A entries, matching m_portfolio_template_mapping
-- _master/_dtls's own "master content, grown by live activity, not a one-time seed" precedent
-- (same PK/FK/status-lifecycle shape, INT8/unique_rowid()).

CREATE TABLE m_candlestick_pattern (
  id                     INT8 PRIMARY KEY DEFAULT unique_rowid(),
  pattern_name           VARCHAR(100) NOT NULL,
  formation_description  TEXT NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX m_candlestick_pattern_name_key ON m_candlestick_pattern (pattern_name);

-- One pattern can have several Q&A entries (different tiers/horizons explaining the same
-- underlying pattern). horizon reuses the exact same string values as frontend/src/lib/
-- candlestickIndicators.ts's HorizonId type ('dayTrading'|'mediumTerm'|'longTerm') - no
-- separate enum, so the two features' horizon concepts can never drift apart.
--
-- status mirrors m_portfolio_template_mapping_master's own 'Pending Approval'|'Approved'|
-- 'Rejected' lifecycle exactly. Phase 1 only ever writes 'Approved' rows (seed content +
-- admin-authored via the Admin Console); Phase 2 will be the first to write 'Pending Approval'
-- rows here (a positively-rated LLM-fallback answer awaiting review) - no schema change needed
-- when that lands.
--
-- source_question_answer_log_id is a Phase-2-only audit pointer (which log row, if any,
-- originated this entry via promotion) - deliberately NOT a DB-enforced FK, since
-- user_evt_candlestick_question_answer_log below has its own FK back to this table
-- (matched_entry_id) and a mutual hard FK would be circular (neither table could be created
-- first). Enforced at the application layer only; never joined for anything load-bearing.
CREATE TABLE m_candlestick_question_answer_entry (
  id                             INT8 PRIMARY KEY DEFAULT unique_rowid(),
  pattern_id                     INT8 NOT NULL REFERENCES m_candlestick_pattern(id) ON DELETE CASCADE,
  horizon                        VARCHAR(20) NOT NULL,
  tier                           INT2 NOT NULL, -- 101 | 201 | 301
  question_text                  TEXT NOT NULL,
  answer_text                    TEXT NOT NULL,
  status                         VARCHAR(20) NOT NULL DEFAULT 'Pending Approval',
  created_by                     INT8 REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by                    INT8 REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at                    TIMESTAMPTZ,
  source_question_answer_log_id  INT8,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candlestick_qa_entry_pattern ON m_candlestick_question_answer_entry(pattern_id);
-- Backs both the curated picker's browse/search query and the LLM's own search_question_answer
-- _entries tool call, both of which always filter to 'Approved' within a given horizon/tier.
CREATE INDEX idx_candlestick_qa_entry_horizon_tier_status ON m_candlestick_question_answer_entry(horizon, tier, status);

-- One row per free-text question asked (the curated-picker path is a cheap read and doesn't get
-- logged here). Doubles as both the rate-limit counting source (every row here represents
-- exactly one real, billed LLM call - even an 'unable_to_answer' outcome still invoked the LLM -
-- so counting rows is correct, unlike fmpRateLimit.service.ts's own table where one row can
-- represent many real calls) and the admin gap-analysis source Phase 2 depends on.
-- No TTL set - this needs to outlive user_evt_usage's own 35-day expiry so Phase 2 can mine
-- older "unable to answer" rows for real gaps; revisit with an explicit retention decision
-- rather than inheriting a shorter default by habit.
CREATE TABLE user_evt_candlestick_question_answer_log (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_text     TEXT NOT NULL,
  horizon           VARCHAR(20) NOT NULL,
  tier              INT2,
  outcome           VARCHAR(30) NOT NULL, -- 'answered_from_kb' | 'unable_to_answer' (Phase 2 adds 'answered_from_llm_fallback')
  matched_entry_id  INT8 REFERENCES m_candlestick_question_answer_entry(id) ON DELETE SET NULL,
  llm_call_details  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candlestick_qa_log_user_created ON user_evt_candlestick_question_answer_log(user_id, created_at DESC);

-- RBAC: two zero-default-grant Functions (same precedent as migration 041's
-- stock_analysis:view) - Admin or Admin-Master can grant either to any role via the normal
-- Manage Permission screen, no code change needed for that to appear there.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('candlestick_question_answer:ask', 'Ask Candlestick Pattern Questions',
   'View the Candlestick Pattern Q&A tab - browse curated pattern questions, or ask a free-text question answered by an LLM against that same curated content.',
   'active'),
  ('candlestick_question_answer:manage_content', 'Manage Candlestick Pattern Q&A Content',
   'Create/edit candlestick patterns and their curated Q&A entries, and review content awaiting approval.',
   'active');

-- Config Properties: LLM model choice + the dedicated rate limit on real (free-text ask) LLM
-- calls - admin-tunable with zero code change via the existing generic ConfigPropertiesPage.tsx.
-- Same 3-block seed pattern (group -> property -> initial value) as migration 044.
INSERT INTO m_config_group (name, description)
VALUES ('Candlestick Q&A', 'Settings for the Candlestick Pattern Q&A LLM feature - model choice and the per-user rate limit on real (free-text ask) LLM calls.');

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'candlestick_question_answer_llm_model', 'LLM Model',
       'Which Anthropic model the free-text ask path calls (e.g. claude-sonnet-5).',
       'string', NULL, NULL, 'active'
FROM m_config_group WHERE name = 'Candlestick Q&A';

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'candlestick_question_answer_max_questions_per_window', 'Max Questions Per Window',
       'Maximum number of free-text questions a single user may ask within the configured window - the curated picker is unaffected, since it never calls the LLM.',
       'integer', '1', NULL, 'active'
FROM m_config_group WHERE name = 'Candlestick Q&A';

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'candlestick_question_answer_rate_limit_window_minutes', 'Rate Limit Window (Minutes)',
       'The rolling window, in minutes, over which candlestick_question_answer_max_questions_per_window is enforced.',
       'integer', '1', NULL, 'active'
FROM m_config_group WHERE name = 'Candlestick Q&A';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, 'claude-sonnet-5', 1, true, NULL
FROM m_config_property WHERE property_key = 'candlestick_question_answer_llm_model';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, '10', 1, true, NULL
FROM m_config_property WHERE property_key = 'candlestick_question_answer_max_questions_per_window';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, '10', 1, true, NULL
FROM m_config_property WHERE property_key = 'candlestick_question_answer_rate_limit_window_minutes';
