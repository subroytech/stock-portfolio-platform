-- Portfolio Upload - Flex, Phase 1 (continued). Both columns stay NULL for every
-- Classic/Legacy-created portfolio, untouched by any of this.
--
-- flex_template_status tracks whether a Flex-created portfolio's template mapping was ever
-- properly resolved (see CLAUDE.md's "Portfolio Upload - Flex" section for the full rationale):
--   'Flex'     - the mapping was proven against a real, rendered Dashboard and Save Template
--                succeeded. upload_template_id is always non-null whenever this is 'Flex'.
--   'Flex-Err' - the portfolio was created but the user left before completing Save Template
--                (or Delete Portfolio). Needs-attention state; upload_template_id stays NULL.
--   NULL       - not a Flex portfolio at all.
-- App-enforced invariant, not a DB constraint: flex_template_status = 'Flex' iff
-- upload_template_id IS NOT NULL.
ALTER TABLE tx_portfolios ADD COLUMN upload_template_id INT8 REFERENCES m_portfolio_template_mapping_master(id) ON DELETE SET NULL;
ALTER TABLE tx_portfolios ADD COLUMN flex_template_status VARCHAR(20);
