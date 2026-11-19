-- Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section). The mapping wizard
-- hardcoded row 1 (aoa[0]) as the header row and column 1 as where real data begins - broken
-- by real broker exports (Charles Schwab: several preamble/account-info rows above the real
-- header row). These two columns let a template record where its real header row and real
-- data columns actually start; how_to_use_description is pure documentation (never read by
-- the parser), shown to the template's creator on future reuse and to an admin reviewing a
-- Pending template.
--
-- 1-based (row/column 1 = the file's first row/column, as a human reads a spreadsheet), not a
-- 0-based array index - keeps the DB value, the API wire value, and the UI identical with no
-- silent +1/-1 translation anywhere except the one place that actually touches a raw JS array
-- (flexParser.service.ts's parseFlexCsv, and the mapping wizard's grid click handler).
--
-- NOT NULL DEFAULT 1 (not nullable) for both index columns, same precedent as status's own
-- NOT NULL DEFAULT 'Pending Approval' on this same table: every row needs a concrete value,
-- and for every template created before this migration, (1, 1) is not a lossy placeholder -
-- it is the literal, previously-hardcoded truth (the file's first row/column is exactly what
-- parseFlexCsv always assumed). This also means every backend/frontend consumer can treat the
-- two columns as always-present integers, never optional-with-null-coalescing.
--
-- how_to_use_description stays nullable with no default, mirroring m_function_master
-- .description exactly - pure free-text documentation, never consumed by parsing logic.
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN header_row_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN data_start_column_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE m_portfolio_template_mapping_master ADD COLUMN how_to_use_description TEXT;
