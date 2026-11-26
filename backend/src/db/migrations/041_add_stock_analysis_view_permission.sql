-- Stock Analysis tab (4-quadrant ticker lookup), 2026-09-06.
--
-- Gated Function, zero default grants (same precedent as migrations 036/040 -
-- contrarian_finder:view_history / usage_audit:view). Unrestricted - NOT added to
-- roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS - Admin or Admin-Master can grant it to any
-- role via the normal Manage Permission screen. RolePermissionsPage.tsx sources its checkbox
-- list live from GET /functions, so this Function appears there automatically.
--
-- This gates only the new tab's own nav visibility/reachability - the underlying
-- GET /stock-preview/:symbol call it uses is unchanged and stays ungated (requireAuth only),
-- since it's already called for arbitrary symbols from several other, ungated pages today.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('stock_analysis:view', 'View Stock Analysis',
   'View the Stock Analysis tab - 4 independent quadrants for looking up any ticker''s price chart.',
   'active');
