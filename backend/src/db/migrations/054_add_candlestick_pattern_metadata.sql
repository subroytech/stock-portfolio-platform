-- Candlestick Pattern Metadata for Deterministic Search (2026-10-04) - Phase 1 of the planned
-- ReAct-style upgrade to Candlestick Pattern Q&A's "Ask Your Own Question" path. Six new columns
-- on m_candlestick_pattern backing a new filter_patterns_by_metadata tool - structured,
-- deterministic facts about each pattern (signal type, directional bias, gap requirement, trend
-- context, synonyms, mirror pattern), kept separate from the existing curated Q&A prose
-- (m_candlestick_question_answer_entry), which stays the domain of the existing free-text
-- search_question_answer_entries tool. Same "property lives on the pattern, not the per-entry
-- row" precedent already established by complexity_tier (migration 050) and the three horizon
-- booleans (migration 048).
--
-- DDL only - the 34-row backfill lives in the next migration, same split-across-files convention
-- this feature has used every time a schema change needs dependent DML (048/049, 050/051),
-- since CockroachDB doesn't reliably make a schema change visible to dependent DML submitted in
-- the same multi-statement batch.
--
-- All six columns get safe, non-breaking defaults so nothing is left in an invalid state before
-- the backfill runs. signal_type/directional_bias/trend_context are app-validated enums (no SQL
-- CHECK constraint), same convention as category/status/complexity_tier already on this table.
--
-- No new indexes: at 34 rows total, every filter_patterns_by_metadata query (any combination of
-- these columns) is a trivial full-table scan regardless - an index would add maintenance
-- surface for zero real performance benefit at this table's size.

-- 'reversal' | 'continuation' | 'indecision'
ALTER TABLE m_candlestick_pattern ADD COLUMN signal_type VARCHAR(20) NOT NULL DEFAULT 'reversal';

-- 'bullish' | 'bearish' | 'neutral' | 'context-dependent'
ALTER TABLE m_candlestick_pattern ADD COLUMN directional_bias VARCHAR(20) NOT NULL DEFAULT 'neutral';

ALTER TABLE m_candlestick_pattern ADD COLUMN requires_gap BOOLEAN NOT NULL DEFAULT false;

-- 'prior-downtrend' | 'prior-uptrend' | 'either' | 'none' - the trend context that makes this
-- pattern meaningful (for a reversal pattern: the trend about to reverse; for a continuation
-- pattern: the trend already in progress that it continues).
ALTER TABLE m_candlestick_pattern ADD COLUMN trend_context VARCHAR(20) NOT NULL DEFAULT 'none';

-- Array of alternate names (e.g. "Inside Bar" for Harami), matched alongside pattern_name by
-- filter_patterns_by_metadata. JSONB array of strings, same "array as JSONB, not a child table"
-- precedent as cash_config/sample_preview elsewhere in this schema - synonym counts per pattern
-- are small (0-2) and never queried independently of their parent pattern. Nullable - most
-- patterns have none.
ALTER TABLE m_candlestick_pattern ADD COLUMN synonyms JSONB;

-- Self-referencing FK to the opposite-direction counterpart of the same formation (e.g. Bullish
-- Engulfing <-> Bearish Engulfing, Hammer <-> Shooting Star). Deliberately NOT used for
-- same-shape-different-meaning pairs like Hammer/Hanging Man - that's a different relationship
-- (identical geometry, context-dependent meaning) reserved for a possible future
-- related-patterns field, not forced into this one. Set symmetrically on both rows of a pair at
-- backfill time so either direction resolves with a plain lookup, no reverse-OR query needed.
ALTER TABLE m_candlestick_pattern ADD COLUMN mirror_pattern_id INT8 REFERENCES m_candlestick_pattern(id) ON DELETE SET NULL;
