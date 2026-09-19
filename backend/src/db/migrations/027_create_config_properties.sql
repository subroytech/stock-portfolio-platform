-- Config Properties framework (2026-08-24) - admin-configurable settings that live in the DB
-- instead of hardcoded constants. Distinct from m_function_master (migration 016), which is a
-- permission-key catalog gating routes - these three tables are a general key/value settings
-- store with full version history, not an RBAC concept. Do not conflate the two.

CREATE TABLE m_config_group (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- property_key is globally unique and, like m_function_master.permission_key, not renamable
-- after creation - real code (contrarianFinder.service.ts) looks it up directly. value_type is
-- app-enforced vocabulary ('integer'|'string'), not a DB CHECK - matches FunctionStatus's
-- existing convention. min_value/max_value are TEXT (like value itself) so a future 'date'
-- value_type needs zero schema change; only meaningful when value_type is numeric.
CREATE TABLE m_config_property (
  id            SERIAL PRIMARY KEY,
  group_id      INT8 NOT NULL REFERENCES m_config_group(id),
  property_key  VARCHAR(150) UNIQUE NOT NULL,
  name          VARCHAR(150) NOT NULL,
  description   TEXT, -- now the ONLY place "which file/service reads this" is documented
  value_type    VARCHAR(20) NOT NULL, -- 'integer'|'string' (app-enforced, see configProperty.service.ts)
  min_value     TEXT,
  max_value     TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active'|'inactive' - never delete, only status-change
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only value history. Exactly one is_active=true row per property_id at a time,
-- enforced via an application-level transactional flip (NOT a partial-unique-index) - same
-- shape as roles.service.ts's setUserRole() and contrarianFinder.service.ts's saveLastScan()
-- user-tier branch. effective_timestamp always equals created_at for now (kept as its own
-- column purely so future scheduling can diverge them later; no scheduling logic exists yet).
-- changed_by is nullable + ON DELETE SET NULL, same audit-trail reasoning as
-- tx_shared_contrarian_run.started_by.
CREATE TABLE m_config_property_value (
  id                  SERIAL PRIMARY KEY,
  property_id         INT8 NOT NULL REFERENCES m_config_property(id) ON DELETE CASCADE,
  value               TEXT NOT NULL,
  version             INT8 NOT NULL,
  effective_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  changed_by          INT8 REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every live read (getConfigValue) filters WHERE property_id = $1 AND is_active = true - this
-- is the hot path (called on every completed Contrarian Finder scan).
CREATE INDEX idx_config_property_value_property_id ON m_config_property_value (property_id);

-- New Function/permission catalog row (migration 016's pattern). Deliberately NOT granted to
-- any role here - see roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS guard, which hardcodes
-- that this key can only ever be granted to the admin-master role. admin-master is a manually-
-- created runtime role, never migration-seeded (migration 021's same note) - granting this
-- permission to it is a documented manual step via the Admin Console's Manage Permission screen.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('config_properties:manage', 'Manage Config Properties',
   'View/create/edit admin-configurable settings (config groups, property definitions, and their value history) - GET/POST/PUT under /config-properties. Grantable only to admin-master (enforced in roles.service.ts).',
   'active');

-- Seed: the one real consumer this first pass wires up - contrarianFinder.service.ts's
-- admin-tier scan history retention limit, replacing hardcoded ADMIN_HISTORY_LIMIT = 60.
-- Seeded to 60 so behavior is unchanged on deploy. min 1 (0 would defeat "history" retention
-- and look like a bug) / max 500 (headroom above the old 60 while still bounding unconstrained
-- table growth from a fat-fingered entry).
INSERT INTO m_config_group (name, description) VALUES
  ('Data Retention Policies', 'How much historical data various features keep before pruning older rows.');

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status) VALUES
  ((SELECT id FROM m_config_group WHERE name = 'Data Retention Policies'),
   'contrarian_finder_admin_history_retention_count',
   'Contrarian Finder Admin History Retention Count',
   'How many rows of admin-tier Contrarian Finder scan history (tx_shared_contrarian_run, run_tier = ''admin'') to retain, pruned after every completed scan. Read by contrarianFinder.service.ts''s saveLastScan(). A code-level fallback of 60 applies if this row is ever missing/unparseable.',
   'integer', '1', '500', 'active');

INSERT INTO m_config_property_value (property_id, value, version, is_active)
  SELECT id, '60', 1, true FROM m_config_property WHERE property_key = 'contrarian_finder_admin_history_retention_count';
