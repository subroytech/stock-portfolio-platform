-- Per-user, per-provider API key + subscription metadata (FMP/Finnhub today,
-- extensible to future providers with zero schema changes - one row per
-- (user, provider)). Unprefixed like `users` rather than `tx_`, since this is
-- account-level data, not portfolio-scoped. api_key_encrypted is always
-- ciphertext (AES-256-GCM via backend/src/utils/encryption.ts) - the raw key
-- is never persisted in plaintext.
CREATE TABLE users_subscriptions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(50) NOT NULL,
  api_key_encrypted  TEXT NOT NULL,
  plan_tier          VARCHAR(50),
  status             VARCHAR(20) NOT NULL DEFAULT 'active',
  renewal_date       DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
