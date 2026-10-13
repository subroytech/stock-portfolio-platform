-- Admin Console Phase 8 - real permission-based UI gating (not just role-name checks).
--
-- api_keys:manage_own gates GET/PUT/DELETE /subscriptions (a user's own FMP/Finnhub keys).
-- Deliberately admin-only by default - confirmed with the user, who accepted the real
-- consequence: every existing non-admin loses access to their own API keys (and therefore
-- most live-data features that depend on a stored key) until an admin explicitly grants
-- this to the 'user' role via the Manage Permission screen.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('api_keys:manage_own', 'Manage Own API Keys', 'View/add/update/delete your own FMP/Finnhub API keys (GET/PUT/DELETE /subscriptions).', 'active');

INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'api_keys:manage_own');
