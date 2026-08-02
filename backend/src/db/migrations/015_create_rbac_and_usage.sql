-- Functional Authorization (RBAC) + Usage Tracking (Architecture.md Section 3 item 6).
--
-- m_roles / m_role_permissions: master/reference data (role catalog + static per-role
-- permission grants) - same bucket as m_index_master/m_index_constituent, whose parent-child
-- shape this mirrors. permission_key is free-text (app-enforced vocabulary, not a DB enum),
-- so adding a new gated feature never needs a schema change.
--
-- users_roles: which roles each user has - per-account data, unprefixed like
-- users_subscriptions, not m_-prefixed (it's not reference/static data, it's per-user).
--
-- user_evt_usage / user_evt_usage_summary_monthly: a new naming bucket for per-user event
-- data, since this fits none of the existing four (m_/tx_/sys_/unprefixed) - tx_ is
-- explicitly portfolio-scoped, sys_ is explicitly internal-not-app-data, and this is neither.
-- user_evt_usage is the raw log (one row per action), retained ~1 month via CockroachDB's
-- native row-level TTL (no cron job needed). user_evt_usage_summary_monthly is one row per
-- (user, feature, month), incremented via UPSERT on every single event write rather than a
-- batch rollup job, retained ~12 months via its own TTL.
CREATE TABLE m_roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users_roles (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES m_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE m_role_permissions (
  role_id         INTEGER NOT NULL REFERENCES m_roles(id) ON DELETE CASCADE,
  permission_key  VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_evt_usage (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature     VARCHAR(50) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) WITH (ttl_expire_after = '35 days');

CREATE TABLE user_evt_usage_summary_monthly (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature      VARCHAR(50) NOT NULL,
  month        DATE NOT NULL,
  event_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature, month)
) WITH (ttl_expire_after = '366 days');

-- Backfill: every existing user gets the baseline 'user' role, so nobody is left roleless.
-- 'admin' starts with just the two permissions this pass actually needs.
INSERT INTO m_roles (name) VALUES ('user'), ('admin');
INSERT INTO users_roles (user_id, role_id)
  SELECT id, (SELECT id FROM m_roles WHERE name = 'user') FROM users;
INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'contrarian_finder:scan'),
         ((SELECT id FROM m_roles WHERE name = 'admin'), 'roles:manage');
