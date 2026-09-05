// Usage Tracking, Architecture.md Section 3 item 6. Backed by user_evt_usage
// (raw log, TTL 35 days) and user_evt_usage_summary_monthly (one row per
// user+feature+month, incremented in real time - no batch rollup job).
// Callers use this fire-and-forget (see the 5 controller call sites) - a
// logging failure must never break the actual feature response.

import { pool } from '../db/pool';

export type UsageFeature = 'momentum' | 'contrarian_finder_scan' | 'long_term_analysis'
  | 'contrarian_comeback' | 'portfolio_refresh';

export async function logUsage(userId: string, feature: UsageFeature): Promise<void> {
  await pool.query('INSERT INTO user_evt_usage (user_id, feature) VALUES ($1, $2)', [userId, feature]);
  await pool.query(
    `INSERT INTO user_evt_usage_summary_monthly (user_id, feature, month, event_count)
     VALUES ($1, $2, date_trunc('month', now())::date, 1)
     ON CONFLICT (user_id, feature, month)
     DO UPDATE SET event_count = user_evt_usage_summary_monthly.event_count + 1, updated_at = now()`,
    [userId, feature],
  );
}
