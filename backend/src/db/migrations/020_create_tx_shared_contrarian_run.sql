-- Persists the last completed Contrarian Finder scan server-side, so it's
-- shared across every user rather than living only in the running browser's
-- sessionStorage (confirmed live 2026-08-04: a regular user, or the same
-- admin on a different device/session, saw nothing at all - not because of
-- any staleness check, but because nothing was ever stored anywhere they
-- could read it from). Written once, at the end of a successfully completed
-- scan - never for a partial/abandoned/failed one.
--
-- tx_ prefix used deliberately for non-portfolio-scoped shared/global data -
-- a documented departure from SCHEMA.md's current tx_ definition (see its
-- naming-convention section for the exception note). No status/error_message
-- columns: every row here is, by construction, a completed run.
CREATE TABLE tx_shared_contrarian_run (
  id            INT8 PRIMARY KEY DEFAULT unique_rowid(),
  started_by    INT8 REFERENCES users(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  universe_size INT8 NOT NULL,
  scanned       INT8 NOT NULL,
  params        JSONB NOT NULL,
  results       JSONB NOT NULL
);
