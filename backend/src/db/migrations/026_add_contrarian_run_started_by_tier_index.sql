-- Index the two hot-path lookups in contrarianFinder.service.ts's saveLastScan():
-- the user-tier retention's `DELETE ... WHERE started_by = $1 AND run_tier = 'user'`,
-- and (partially) the admin-tier prune's `ORDER BY completed_at DESC LIMIT 60` scan.
-- Previously an accepted gap (see SCHEMA.md's tx_shared_contrarian_run note) while the
-- table was small - both queries were doing a full table scan.
CREATE INDEX idx_shared_contrarian_run_started_by_run_tier ON tx_shared_contrarian_run(started_by, run_tier);
