-- Portfolio Upload - Flex: footer marker support (see the "Flex CSV Parsing" plan in
-- CLAUDE.md/Architecture.md). Real broker exports often have footer content below the real
-- holdings (totals rows, disclaimers) that the parser previously had no way to exclude. Unlike
-- header_row_index/data_start_column_index (migration 025, always a fixed position from the
-- top), the footer can't be captured as a row position - a template is reused across uploads
-- with different holding counts, so the footer's row position moves every time. Instead it's a
-- (column, "contains" match string) pair: the first row whose cell in that column contains the
-- text marks where the footer begins.
--
-- Both nullable, unlike header_row_index/data_start_column_index's NOT NULL DEFAULT 1 - "no
-- footer configured" is a common, valid state (not every file has one), not a lossy
-- placeholder. NULL on both (the backfilled state for every template created before this
-- migration) means "parse to the real end of file," i.e. zero behavior change for existing
-- templates. Enforced at the service layer that the two columns are always set/unset together,
-- not a DB constraint - matches this schema's existing app-enforced-vocabulary convention.
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN footer_marker_column_index INTEGER;
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN footer_marker_text VARCHAR(200);
