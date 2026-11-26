-- Admin - Portfolio Admin - Manage Portfolio (2026-11-14). Gated Function, granted to 'admin' here.
-- admin-master is a manually-created runtime role (see migration 024), so it gets this grant via the
-- Admin Console's Manage Permission screen or a one-off SQL grant, the same as its other custom-role
-- grants. Not added to roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS - Admin can grant it too.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('portfolio_admin:manage', 'Manage Portfolios (Admin)',
   'View every user''s portfolios across Active / In-Active / Soft-Delete, restore a Soft-Delete portfolio, or permanently delete one (GET/POST/DELETE /portfolio-admin/portfolios).',
   'active');

INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'portfolio_admin:manage');
