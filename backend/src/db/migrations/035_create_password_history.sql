-- Password history (CLAUDE.md's "Self-Registration & Password Policy" section) - rule 7 of the
-- password policy: a new password can't repeat any of the user's last 5. user_evt_-prefixed,
-- same bucket as user_evt_usage/user_evt_impersonation_log (per-user append log). No TTL -
-- unlike usage/audit logs, "last 5" must survive indefinitely per account, not expire after a
-- fixed window. passwordHistory.service.ts prunes back to the 5 most-recent rows per user on
-- every insert instead - same insert-then-prune shape as contrarianFinder.service.ts's
-- admin-tier scan history.
CREATE TABLE user_evt_password_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_history_user_id ON user_evt_password_history (user_id, created_at);
