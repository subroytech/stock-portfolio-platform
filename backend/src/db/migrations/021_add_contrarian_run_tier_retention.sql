-- Contrarian Finder shared last-scan: tiered retention (2026-08-05).
--
-- Admin/admin-master runs keep a rolling history (capped at the 60 most
-- recent admin-tier rows, pruned after each insert) - separate from other
-- contrarian_finder:scan-permitted roles (user-contra-withKey/wokey), whose
-- runs instead upsert a single row per user (contrarianFinder.service.ts's
-- saveLastScan() does a transactional DELETE+INSERT keyed on
-- started_by + run_tier = 'user'). GET /contrarian-finder/last-scan is
-- unaffected - still just ORDER BY completed_at DESC LIMIT 1 across every
-- row regardless of tier (confirmed with the user: this is a
-- storage/retention change, not a viewer-facing one).
--
-- Existing rows backfilled 'admin' - both were genuinely run by an admin
-- account (confirmed via started_by before this migration).
ALTER TABLE tx_shared_contrarian_run ADD COLUMN run_tier VARCHAR(20) NOT NULL DEFAULT 'admin';

-- contrarian_finder:scan_history distinguishes "admin/admin-master" from
-- other contrarian_finder:scan-permitted roles - a dedicated permission
-- rather than a hardcoded role-name check, consistent with the rest of this
-- RBAC system (requirePermission is DB-backed, not role-name string checks).
-- admin-master is a manually-created runtime role, never migration-seeded
-- (see Functional Authorization, Architecture.md Section 1), so this
-- migration only grants 'admin' here - admin-master needs the same grant
-- made manually via the Admin Console's Manage Permission screen, same as
-- its other grants.
INSERT INTO m_function_master (permission_key, name, description, status) VALUES
  ('contrarian_finder:scan_history', 'Contrarian Finder Scan History', 'Scans retain a rolling 60-run history instead of one upserted row per user, and mark the account as the admin tier for Contrarian Finder shared last-scan retention.', 'active');

INSERT INTO m_role_permissions (role_id, permission_key)
  VALUES ((SELECT id FROM m_roles WHERE name = 'admin'), 'contrarian_finder:scan_history');
