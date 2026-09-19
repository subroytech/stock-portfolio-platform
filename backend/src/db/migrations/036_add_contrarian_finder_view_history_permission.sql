-- Contrarian Finder — Run History (view archived runs), 2026-08-31.
--
-- Gated Function, zero default grants (precedented by migrations 027/032 -
-- config_properties:manage/users:impersonate). Unlike those two this is NOT
-- added to roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS - the user asked
-- for "Admin or Admin-Master" to be able to grant it to any role, i.e. the
-- normal, unrestricted grant path every other permission already uses.
-- RolePermissionsPage.tsx sources its checkbox list live from GET /functions,
-- so this Function appears in the Admin Console's Manage Permission screen
-- automatically - no frontend admin-console change needed for the grant
-- mechanism itself.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('contrarian_finder:view_history', 'View Contrarian Finder Run History',
   'View past Contrarian Finder scan results (not just the latest), via the Run History drawer.',
   'active');
