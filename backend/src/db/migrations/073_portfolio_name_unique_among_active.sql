-- Portfolio names are unique per user among ACTIVE portfolios only (2026-11-14). A Soft-Delete
-- portfolio releases its name, so the user can reuse it; Restore is then blocked with a clear
-- message if the name has since been taken (the app checks this before restoring, since a partial
-- unique index can't express a restore-time conflict on its own).
-- Replaces migration 002's inline UNIQUE (user_id, name) constraint, portfolios_user_id_name_key.
ALTER TABLE tx_portfolios DROP CONSTRAINT IF EXISTS portfolios_user_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_id_name_active_key
  ON tx_portfolios (user_id, name) WHERE status = 'Active';
