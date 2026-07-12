// Per-user, per-provider API key + subscription metadata. Decided 2026-07-12
// (Architecture.md Section 2 / the user-API-key-model plan) — user picked
// bringing their own FMP/Finnhub key over a shared pooled key. This service
// only manages the credential/metadata storage; it does NOT yet wire these
// keys into the actual FMP call sites (quotes/contrarianFinder/portfolio
// refresh-prices still use the global env.fmpApiKey) — that's a separate,
// larger follow-up noted in Architecture.md Section 3.

import { pool } from '../db/pool';
import { encrypt, decrypt } from '../utils/encryption';

export interface SubscriptionInput {
  apiKey: string;
  planTier?: string | null;
  status?: string;
  renewalDate?: string | null;
}

export interface MaskedSubscription {
  provider: string;
  maskedKey: string;
  planTier: string | null;
  status: string;
  renewalDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  provider: string;
  api_key_encrypted: string;
  plan_tier: string | null;
  status: string;
  renewal_date: string | null;
  created_at: string;
  updated_at: string;
}

// Decrypts only to compute a display-safe mask — the plaintext key is never
// returned to a caller of this service.
function maskKey(plaintext: string): string {
  const last4 = plaintext.slice(-4);
  return `••••••••${last4}`;
}

function mapRow(r: SubscriptionRow): MaskedSubscription {
  return {
    provider: r.provider,
    maskedKey: maskKey(decrypt(r.api_key_encrypted)),
    planTier: r.plan_tier,
    status: r.status,
    renewalDate: r.renewal_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSubscriptions(userId: string): Promise<MaskedSubscription[]> {
  const { rows } = await pool.query<SubscriptionRow>(
    `SELECT provider, api_key_encrypted, plan_tier, status, renewal_date, created_at, updated_at
     FROM users_subscriptions WHERE user_id = $1 ORDER BY provider`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function upsertSubscription(
  userId: string,
  provider: string,
  input: SubscriptionInput,
): Promise<MaskedSubscription> {
  const encrypted = encrypt(input.apiKey);
  const { rows } = await pool.query<SubscriptionRow>(
    `INSERT INTO users_subscriptions (user_id, provider, api_key_encrypted, plan_tier, status, renewal_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       api_key_encrypted = excluded.api_key_encrypted,
       plan_tier = excluded.plan_tier,
       status = excluded.status,
       renewal_date = excluded.renewal_date,
       updated_at = now()
     RETURNING provider, api_key_encrypted, plan_tier, status, renewal_date, created_at, updated_at`,
    [userId, provider, encrypted, input.planTier ?? null, input.status ?? 'active', input.renewalDate ?? null],
  );
  return mapRow(rows[0]);
}

export async function deleteSubscription(userId: string, provider: string): Promise<boolean> {
  const { rows } = await pool.query(
    'DELETE FROM users_subscriptions WHERE user_id = $1 AND provider = $2 RETURNING id',
    [userId, provider],
  );
  return rows.length > 0;
}
