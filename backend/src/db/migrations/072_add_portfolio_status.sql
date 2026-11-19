-- Portfolio lifecycle status (2026-11-14). Three values, app-enforced (no DB check constraint, same
-- convention as flex_template_status / status columns elsewhere in this schema):
--   'Active'      - normal, visible in the owner's Portfolio tab.
--   'In-Active'   - reserved for future use; hidden from the owner, no UI sets it yet.
--   'Soft-Delete' - the owner removed it. Hidden from the owner; an admin can restore it to
--                   'Active' or permanently delete it from Admin - Portfolio Admin - Manage Portfolio.
-- DEFAULT 'Active' backfills every existing portfolio row, so nothing currently visible changes.
-- Schema only - the name-uniqueness change lives in migration 073, split out for the same
-- CockroachDB schema-change-visibility reason documented in migration 048.
ALTER TABLE tx_portfolios ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active';
