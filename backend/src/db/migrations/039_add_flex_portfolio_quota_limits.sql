-- Flex Portfolio Quota Limits (Phase 3), 2026-09-05. Today a user can create unlimited
-- Portfolio Templates and unlimited Flex portfolios - this adds global defaults (via the
-- existing Config Properties framework, migration 027) plus per-user override columns on
-- users. Schema only - no application code reads these yet (a later phase wires enforcement
-- into portfolioTemplate.service.ts's createTemplate() and portfolio.service.ts's
-- createPortfolioFlex()).

INSERT INTO m_config_group (name, description) VALUES
  ('Flex Portfolio Limits', 'Per-user caps on Portfolio Upload - Flex template creation and Flex portfolio creation.');

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'portfolio_flex_max_pending_templates', 'Max Pending-Approval Templates',
       'Maximum number of Portfolio Templates a user may have in Pending Approval status at once. Overridable per-user via users.flex_max_pending_templates_override. Read by portfolioTemplate.service.ts''s createTemplate().',
       'integer', '1', '20', 'active'
FROM m_config_group WHERE name = 'Flex Portfolio Limits';

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'portfolio_flex_max_approved_templates', 'Max Approved Templates',
       'Maximum number of Approved Portfolio Templates a user may have at once. Overridable per-user via users.flex_max_approved_templates_override. Read by portfolioTemplate.service.ts''s createTemplate().',
       'integer', '1', '50', 'active'
FROM m_config_group WHERE name = 'Flex Portfolio Limits';

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'portfolio_flex_max_portfolios', 'Max Flex Portfolios',
       'Maximum number of portfolios a user may create via Portfolio Upload - Flex at once (counts flex_template_status IN (''Flex'', ''Flex-Err'')). Overridable per-user via users.flex_max_portfolios_override. Read by portfolio.service.ts''s createPortfolioFlex().',
       'integer', '1', '50', 'active'
FROM m_config_group WHERE name = 'Flex Portfolio Limits';

INSERT INTO m_config_property_value (property_id, value, version, is_active)
  SELECT id, '2', 1, true FROM m_config_property WHERE property_key = 'portfolio_flex_max_pending_templates';
INSERT INTO m_config_property_value (property_id, value, version, is_active)
  SELECT id, '5', 1, true FROM m_config_property WHERE property_key = 'portfolio_flex_max_approved_templates';
INSERT INTO m_config_property_value (property_id, value, version, is_active)
  SELECT id, '6', 1, true FROM m_config_property WHERE property_key = 'portfolio_flex_max_portfolios';

ALTER TABLE users ADD COLUMN flex_max_pending_templates_override INT8;
ALTER TABLE users ADD COLUMN flex_max_approved_templates_override INT8;
ALTER TABLE users ADD COLUMN flex_max_portfolios_override INT8;
