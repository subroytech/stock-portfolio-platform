-- Portfolio Upload - Flex, Phase 1 (continued). Portfolio import has had zero permission gate
-- until now - confirmed with the user which default avoids a breaking regression:
-- portfolio_upload:legacy is granted to 'user' here too, so nobody loses today's working
-- import on rollout. portfolio_upload:flex stays admin-granted-only (the new, less-proven
-- path) until an admin deliberately extends it via Manage Permission.
--
-- admin-master is a manually-created runtime role, never migration-seeded (see Functional
-- Authorization, Architecture.md Section 1), so this migration only grants 'admin'/'user'
-- here - admin-master needs the same grants made manually via the Admin Console's Manage
-- Permission screen (or a direct one-off SQL grant), same as its other custom-role grants.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('portfolio_upload:legacy', 'Portfolio Upload - Legacy', 'Import a portfolio via the existing Fidelity/Empower/Robinhood parser (POST /portfolios/:id/import).', 'active'),
  ('portfolio_upload:flex', 'Portfolio Upload - Flex', 'Create/import a portfolio via a user-defined, admin-governed column-mapping template (POST /portfolios/flex and related routes).', 'active'),
  ('portfolio_template:manage_status', 'Manage Portfolio Template Status', 'Approve or reject a Portfolio Upload - Flex template (PUT /portfolio-templates/:id/status).', 'active');

INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'user'), 'portfolio_upload:legacy'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'portfolio_upload:legacy'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'portfolio_upload:flex'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'portfolio_template:manage_status');
