-- User Usage Dashboard, 2026-09-05. Gated Function, zero default grants (same precedent as
-- migration 036's contrarian_finder:view_history) - not added to roles.service.ts's
-- ADMIN_MASTER_ONLY_PERMISSIONS, so Admin or Admin-Master can grant it to any role via the
-- normal Manage Permission screen, same as every other unrestricted permission.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('usage_audit:view', 'View User Usage Dashboard',
   'View the per-user usage ranking (Last 3 Days / Monthly) under Admin - User Usage.',
   'active');
