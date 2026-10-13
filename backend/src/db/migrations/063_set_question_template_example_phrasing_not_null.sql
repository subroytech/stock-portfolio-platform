-- Constrains migration 061's example_phrasing column NOT NULL, now that migration 062 has
-- backfilled every existing row. Split into its own file for the same CockroachDB
-- schema-change-visibility reason documented in migration 061/048's headers. Every future
-- admin-authored template needs one too, same required-field precedent as
-- template_key/regex_pattern/answer_template.
ALTER TABLE m_question_template ALTER COLUMN example_phrasing SET NOT NULL;
