-- Portfolio Upload - Flex: cash/cash-equivalent row identification (Phase 2, see CLAUDE.md's
-- "Flex CSV Parsing" section). Mirrors migration 028's footer_marker_column_index/
-- footer_marker_text exactly - a (column, "contains" text) pair, checked against the raw file
-- coordinate space, both nullable since "no cash marker configured" is the common default state
-- (matches every existing template's behavior unchanged).
--
-- cash_value_column_index is independently nullable from the marker pair - a matched cash row
-- with no configured value column falls back to quantity x currentPrice
-- (flexParser.service.ts's parseFlexCsv), same shape as Legacy's own cash-row handling in
-- parser.service.ts. Unlike the footer marker (a single row boundary), the cash marker can
-- match multiple rows - every match is excluded from holdings and its value summed into
-- cashAmount.
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN cash_marker_column_index INTEGER;
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN cash_marker_text VARCHAR(200);
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN cash_value_column_index INTEGER;
