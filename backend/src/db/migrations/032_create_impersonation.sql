-- "Login-as" impersonation (support/troubleshooting tool for the multi-role rollout) - lets an
-- admin-master see the app exactly as a specific user sees it, without their password. New
-- Function/permission catalog row (migration 016's pattern). Deliberately NOT granted to any
-- role here - see roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS guard, which hardcodes that
-- this key can only ever be granted to the admin-master role. Granting it to admin-master is a
-- deliberate manual SQL step (not through the Admin Console's Manage Permission screen), same
-- "backend-only rollout" precedent as config_properties:manage.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('users:impersonate', 'Login as User',
   'Temporarily assume another user''s session for troubleshooting, without their password - POST /auth/impersonate, POST /auth/stop-impersonating. Grantable only to admin-master (enforced in roles.service.ts).',
   'active');

-- user_evt_ prefix - per-user event data, same bucket as user_evt_usage (migration 015). One row
-- per impersonation session start; ended_at stays null if the session just expires/is abandoned
-- rather than explicitly ended via "Return to my account" - acceptable, matches how most audit
-- trails handle it. TTL longer than usage-tracking's 35/366 days - this is a security audit
-- trail, worth keeping longer.
CREATE TABLE user_evt_impersonation_log (
  id              SERIAL PRIMARY KEY,
  admin_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
) WITH (ttl_expire_after = '180 days');
