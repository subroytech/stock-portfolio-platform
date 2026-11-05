-- Admin Console, Phase 1 (Architecture.md Section 3 item 6 follow-up).
--
-- m_function_master: catalogs only the app "functions" that are genuine EXCEPTIONS to the
-- default "any signed-in user can use it" rule - NOT every application function. Momentum,
-- Long-Term Analysis, Contrarian Comeback, and Portfolio Refresh Prices are intentionally
-- absent (they aren't exceptions, so they get no row and no requirePermission gate). Adds a
-- real FK from m_role_permissions.permission_key so a role can never be granted a permission
-- key that isn't a real registered function - upgrades the fixed-dropdown UI decision (the
-- permission picker) to a DB-enforced guarantee, not just an app-level convention.
--
-- 'roles:manage' is re-keyed here in meaning, not in data: migration 015 already granted admin
-- this key when it gated PUT /users/:id/role. That grant row is untouched - it just stops
-- being consumed by the role-change endpoint (which moves to users:manage_roles below) and
-- starts being consumed by the new POST /roles instead. Nothing regresses because admin is
-- also granted users:manage_roles in this same migration.
CREATE TABLE m_function_master (
  id              SERIAL PRIMARY KEY,
  permission_key  VARCHAR(100) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active'|'inactive'|'Dev-WIP'|'QA-Test'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('contrarian_finder:scan', 'Run Contrarian Finder Scan', 'Run a Contrarian Finder batch scan (POST /contrarian-finder/scan-batch).', 'active'),
  ('roles:manage', 'Manage Roles', 'Create a new role (POST /roles).', 'active'),
  ('permissions:manage', 'Manage Role Permissions', 'View/grant/revoke which permissions a role has (GET/POST/DELETE /roles/:id/permissions), and list the function catalog (GET /functions).', 'active'),
  ('users:manage_roles', 'Manage User Roles', 'View users and change a user''s assigned role (GET /users, PUT /users/:id/role).', 'active'),
  ('functions:manage', 'Manage Functions', 'Create/edit m_function_master rows and their lifecycle status (POST /functions, PUT /functions/:id).', 'active');

-- admin already has contrarian_finder:scan + roles:manage from migration 015.
INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'users:manage_roles'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'permissions:manage'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'functions:manage');

-- Safe now: every existing m_role_permissions row's key is present in m_function_master above.
ALTER TABLE m_role_permissions
  ADD CONSTRAINT fk_role_permissions_function
  FOREIGN KEY (permission_key) REFERENCES m_function_master (permission_key);
