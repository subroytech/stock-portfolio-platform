-- Admin Console Phase 6 - Create User + status-gated login.
--
-- users.status: account lifecycle, app-enforced vocabulary (no DB enum) - same free-text
-- precedent as users_subscriptions.status/m_function_master.status. DEFAULT 'active'
-- backfills every existing row automatically. Valid values enforced in code
-- (users.service.ts's isValidUserStatus): 'active'|'deactivated'|'cancelled'|'pending'.
ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';

-- 'users:create' is a genuine exception (admin-only account creation, not open to all signed-in
-- users) - same cataloging principle as every other m_function_master row.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('users:create', 'Create User', 'Create a new user account with an initial status/password (POST /users).', 'active');

INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'users:create');
