-- Candlestick Pattern Q&A - Category axis + pattern-level relevant horizons (2026-09-26).
-- Schema (DDL) only - the data backfill lives in migration 049, deliberately split into its own
-- file/query rather than mixed into this one. CockroachDB doesn't reliably make a schema change
-- visible to dependent DML submitted in the same multi-statement batch (found live: an UPDATE
-- referencing a column ADD'd by an earlier statement in this same file failed with "column does
-- not exist" even though the ALTER TABLE had already run) - splitting across migration files
-- (each its own pool.query() call per migrate.ts) sidesteps this entirely.
--
-- Two design decisions from this session, both explicit user direction:
--
-- 1. horizon-relevance is a property of the PATTERN ("does a Doji matter for day-trading?"), not
--    something re-decided per Q&A entry. Three explicit boolean columns on m_candlestick_pattern
--    (not an array) - more directly readable in a SQL client, and horizon is a genuinely fixed
--    3-value concept so an array's extensibility buys little here. Named to match the existing
--    Horizon type's actual values (dayTrading/mediumTerm/longTerm) used everywhere else in this
--    codebase, not "swing_trading" - the UI still LABELS it "Swing Trading" to users, same as
--    HORIZON_LABELS already does today, but the underlying vocabulary stays single-sourced.
--    m_candlestick_question_answer_entry.horizon is dropped entirely once patterns are backfilled
--    (migration 049) - one mechanism, not a hybrid.
--
-- 2. A new Category axis on entries, in a fixed, difficulty-ordered sequence: Definition ->
--    Interpretation -> Reliability -> How to Use -> Common Mistakes. Definition/Interpretation
--    map to tier 101; Reliability/How to Use/Common Mistakes map to tier 201. Tier 301 is
--    deliberately reserved for later, different content (combining MULTIPLE patterns into one
--    interpretation), not this axis.
--
-- user_evt_candlestick_question_answer_log's own horizon column is untouched - that's a snapshot
-- of which horizon the ASKER picked for a given question, unrelated to pattern metadata.

ALTER TABLE m_candlestick_pattern ADD COLUMN is_day_trading BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE m_candlestick_pattern ADD COLUMN is_medium_term BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE m_candlestick_pattern ADD COLUMN is_long_term BOOLEAN NOT NULL DEFAULT false;

-- App-validated enum (same convention as horizon/tier already were - no SQL CHECK constraint).
-- Defaults every existing row to 'Definition' - migration 049 corrects the 4 entries that are
-- actually a different category.
ALTER TABLE m_candlestick_question_answer_entry ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'Definition';

-- horizon is now fully superseded by the pattern-level columns above - safe to drop here (rather
-- than waiting for migration 049's backfill) since 049 never reads entry.horizon at all; it
-- derives every backfilled value from pattern_name/tier, hardcoded from this session's own
-- review of the existing content.
DROP INDEX idx_candlestick_qa_entry_horizon_tier_status;
ALTER TABLE m_candlestick_question_answer_entry DROP COLUMN horizon;

CREATE INDEX idx_candlestick_qa_entry_tier_category_status ON m_candlestick_question_answer_entry(tier, category, status);
