-- Portfolio Upload - Flex: cash config redesigned as a single JSONB blob, replacing the three
-- flat columns from migration 030. Driven by two real, distinct patterns surfacing in practice
-- (CLAUDE.md's "Flex CSV Parsing" section): #1 identifier text and dollar value in separate
-- columns of the same row (the only shape the old columns supported); #2 identifier text and
-- dollar value fused into a single cell (e.g. "Cash, Money Funds and Bank Deposits: $2,143.67").
-- A discriminated `valueSource` shape absorbs future variants without another migration each
-- time - same precedent as this table's existing sample_preview JSONB column.
--
-- Shape: { markerColumnIndex: number, markerText: string,
--          valueSource?: { type: 'column', columnIndex: number } | { type: 'embedded' } }
-- valueSource omitted entirely = the implicit fallback (quantity x currentPrice), unchanged.
--
-- No live template currently has any of the three old columns populated (confirmed via direct
-- query before writing this migration) - a clean swap, no backfill needed.
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN cash_config JSONB;
ALTER TABLE m_portfolio_template_mapping_master DROP COLUMN cash_marker_column_index;
ALTER TABLE m_portfolio_template_mapping_master DROP COLUMN cash_marker_text;
ALTER TABLE m_portfolio_template_mapping_master DROP COLUMN cash_value_column_index;
