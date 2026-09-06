// Usage Tracking, Architecture.md Section 3 item 6. Backed by user_evt_usage
// (raw log, TTL 35 days) and user_evt_usage_summary_monthly (one row per
// user+feature+month, incremented in real time - no batch rollup job).
// Callers use this fire-and-forget (see the 5 controller call sites) - a
// logging failure must never break the actual feature response.

import { pool } from '../db/pool';

export type UsageFeature = 'momentum' | 'contrarian_finder_scan' | 'long_term_analysis'
  | 'contrarian_comeback' | 'portfolio_refresh';

// Usage Audit - API-call detail (Phase 2, 2026-09-05). event_count (above) only ever meant
// "how many times was this feature invoked" - it badly understates real external API volume
// for the heaviest features (one Refresh Prices click is many FMP calls, not one). This
// optional per-identifier breakdown, e.g. { fmp_quote: 20, fmp_historical: 22 }, is stored
// alongside each raw event and later folded into the summary's own cumulative JSONB by
// maybeRunDailyUsageAggregation() below - never merged in real time, to keep this hot,
// fire-and-forget call exactly as cheap as it was before this field existed.
export type ApiCallDetails = Record<string, number>;

export async function logUsage(userId: string, feature: UsageFeature, apiCallDetails?: ApiCallDetails): Promise<void> {
  await pool.query(
    'INSERT INTO user_evt_usage (user_id, feature, api_call_details) VALUES ($1, $2, $3)',
    [userId, feature, apiCallDetails ? JSON.stringify(apiCallDetails) : null],
  );
  await pool.query(
    `INSERT INTO user_evt_usage_summary_monthly (user_id, feature, month, event_count)
     VALUES ($1, $2, date_trunc('month', now())::date, 1)
     ON CONFLICT (user_id, feature, month)
     DO UPDATE SET event_count = user_evt_usage_summary_monthly.event_count + 1, updated_at = now()`,
    [userId, feature],
  );
}

const AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface RawUsageDetailRow {
  id: string;
  user_id: string;
  feature: UsageFeature;
  month: string;
  api_call_details: ApiCallDetails;
}

function mergeCounts(base: ApiCallDetails | null, addition: ApiCallDetails): ApiCallDetails {
  const merged: ApiCallDetails = { ...(base ?? {}) };
  for (const [key, count] of Object.entries(addition)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

// Watermark-gated daily sweep (sys_usage_aggregation_watermark, migration 038) - merges every
// raw user_evt_usage row's api_call_details into user_evt_usage_summary_monthly's own
// cumulative api_call_details, then deletes the now-aggregated raw rows. Triggered
// fire-and-forget from auth.controller.ts's login() handler; the cheap watermark check below
// makes every login except the first one in a 24h window a single no-op read, regardless of
// how many users log in during that window (a global sweep, not a per-user one).
export async function maybeRunDailyUsageAggregation(): Promise<void> {
  const { rows: watermarkRows } = await pool.query<{ last_aggregated_at: Date }>(
    'SELECT last_aggregated_at FROM sys_usage_aggregation_watermark WHERE id = 1',
  );
  const lastAggregatedAt = watermarkRows[0]?.last_aggregated_at;
  if (lastAggregatedAt && Date.now() - lastAggregatedAt.getTime() < AGGREGATION_INTERVAL_MS) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // User Usage Dashboard (2026-09-05) needs a full 3 days of raw detail to exist for its
    // "Last 3 Days" ranking - so a row is only ever folded into the summary and deleted once
    // it's more than 3 days old, never while it's still inside that display window. Delays the
    // monthly summary's own api_call_details by up to 3 extra days for the newest activity -
    // already confirmed acceptable (same "a few days' lag is fine" tolerance as the original
    // design).
    const { rows: rawRows } = await client.query<RawUsageDetailRow>(
      `SELECT id, user_id, feature, date_trunc('month', created_at)::date AS month, api_call_details
       FROM user_evt_usage WHERE api_call_details IS NOT NULL AND created_at < now() - interval '3 days' FOR UPDATE`,
    );

    if (rawRows.length > 0) {
      const grouped = new Map<string, { userId: string; feature: UsageFeature; month: string; details: ApiCallDetails }>();
      for (const row of rawRows) {
        const key = `${row.user_id}|${row.feature}|${row.month}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.details = mergeCounts(existing.details, row.api_call_details);
        } else {
          grouped.set(key, { userId: row.user_id, feature: row.feature, month: row.month, details: { ...row.api_call_details } });
        }
      }

      for (const { userId, feature, month, details } of grouped.values()) {
        const { rows: summaryRows } = await client.query<{ api_call_details: ApiCallDetails | null }>(
          'SELECT api_call_details FROM user_evt_usage_summary_monthly WHERE user_id = $1 AND feature = $2 AND month = $3',
          [userId, feature, month],
        );
        const merged = mergeCounts(summaryRows[0]?.api_call_details ?? null, details);
        await client.query(
          `UPDATE user_evt_usage_summary_monthly SET api_call_details = $4, updated_at = now()
           WHERE user_id = $1 AND feature = $2 AND month = $3`,
          [userId, feature, month, JSON.stringify(merged)],
        );
      }

      // Delete exactly the rows locked/aggregated above, by id - not a bare re-evaluated
      // predicate. A concurrent logUsage() insert with api_call_details could otherwise land
      // between the SELECT ... FOR UPDATE snapshot and this DELETE, matching a blanket
      // "WHERE api_call_details IS NOT NULL" and getting silently discarded without ever being
      // aggregated into the summary.
      await client.query('DELETE FROM user_evt_usage WHERE id = ANY($1)', [rawRows.map((r) => r.id)]);
    }

    await client.query(
      'UPDATE sys_usage_aggregation_watermark SET last_aggregated_at = now() WHERE id = 1',
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// User Usage Dashboard (2026-09-05) - read side. A single "usage score" per user: real
// API-call counts where known (summed from api_call_details), falling back to a plain
// per-event count of 1 for the 3 features that don't have call-level detail yet
// (momentum/long_term_analysis/contrarian_comeback) - confirmed scoring rule.
export interface UsageRankingEntry {
  userId: string;
  email: string;
  totalScore: number;
  byFeature: Partial<Record<UsageFeature, number>>;
}

function scoreForRow(apiCallDetails: ApiCallDetails | null, eventFallback: number): number {
  if (!apiCallDetails) return eventFallback;
  return Object.values(apiCallDetails).reduce((sum, n) => sum + n, 0);
}

function buildRanking(
  rows: { user_id: string; email: string; feature: UsageFeature | null; score: number }[],
): UsageRankingEntry[] {
  const byUser = new Map<string, UsageRankingEntry>();
  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = { userId: row.user_id, email: row.email, totalScore: 0, byFeature: {} };
      byUser.set(row.user_id, entry);
    }
    if (row.feature) {
      entry.totalScore += row.score;
      entry.byFeature[row.feature] = (entry.byFeature[row.feature] ?? 0) + row.score;
    }
  }
  // Zero-usage users appear too (LEFT JOIN from users below) - sorted last, not hidden, so an
  // admin can also see who's been inactive.
  return [...byUser.values()].sort((a, b) => b.totalScore - a.totalScore);
}

// LEFT JOIN from users, not an inner join from the event table - a user with zero activity in
// the window must still appear (score 0), not be silently omitted from an audit view.
export async function getUsageRankingLast3Days(): Promise<UsageRankingEntry[]> {
  const { rows } = await pool.query<{ user_id: string; email: string; feature: UsageFeature | null; api_call_details: ApiCallDetails | null }>(
    `SELECT u.id AS user_id, u.email, ue.feature, ue.api_call_details
     FROM users u
     LEFT JOIN user_evt_usage ue ON ue.user_id = u.id AND ue.created_at >= now() - interval '3 days'`,
  );
  return buildRanking(rows.map((r) => ({
    user_id: r.user_id, email: r.email, feature: r.feature,
    score: r.feature ? scoreForRow(r.api_call_details, 1) : 0,
  })));
}

export async function getUsageRankingForMonth(month: string): Promise<UsageRankingEntry[]> {
  const { rows } = await pool.query<{
    user_id: string; email: string; feature: UsageFeature | null;
    event_count: number | null; api_call_details: ApiCallDetails | null;
  }>(
    `SELECT u.id AS user_id, u.email, s.feature, s.event_count, s.api_call_details
     FROM users u
     LEFT JOIN user_evt_usage_summary_monthly s ON s.user_id = u.id AND s.month = $1`,
    [month],
  );
  return buildRanking(rows.map((r) => ({
    user_id: r.user_id, email: r.email, feature: r.feature,
    score: r.feature ? scoreForRow(r.api_call_details, Number(r.event_count ?? 0)) : 0,
  })));
}

// Populates the Monthly sub-tab's month picker - only months with at least one real row (the
// current month is always selectable client-side regardless, degrading to an all-zero view).
export async function getAvailableUsageMonths(): Promise<string[]> {
  const { rows } = await pool.query<{ month: string }>(
    'SELECT DISTINCT month FROM user_evt_usage_summary_monthly ORDER BY month DESC',
  );
  return rows.map((r) => r.month);
}
