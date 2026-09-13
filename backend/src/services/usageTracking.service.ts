// Usage Tracking, Architecture.md Section 3 item 6. Backed by user_evt_usage (raw log - deleted
// by the daily sweep below once a row turns 3 days old, TTL 35 days is just a backstop) and
// user_evt_usage_summary_monthly (one row per user+feature+month). Callers use this
// fire-and-forget (see the 6 controller call sites) - a logging failure must never break the
// actual feature response.

import { pool } from '../db/pool';

export type UsageFeature = 'momentum' | 'contrarian_finder_scan' | 'long_term_analysis'
  | 'contrarian_comeback' | 'portfolio_refresh' | 'stock_preview' | 'quotes';

// Usage Audit - API-call detail (Phase 2, 2026-09-05). event_count (below) only ever meant
// "how many times was this feature invoked" - it badly understates real external API volume
// for the heaviest features (one Refresh Prices click is many FMP calls, not one). This
// optional per-identifier breakdown, e.g. { fmp_quote: 20, fmp_historical: 22 }, is stored
// alongside each raw event and later folded into the summary's own cumulative JSONB by
// maybeRunDailyUsageAggregation() below - never merged in real time, to keep this hot,
// fire-and-forget call cheap. Every key is provider-prefixed ('fmp'/'fmp_quote'/'fmp_historical'
// vs 'finnhub'/'finnhub_news', etc.) - splitByProvider() below relies on that convention to
// report FMP/Finnhub volume separately without needing a second column.
export type ApiCallDetails = Record<string, number>;

export async function logUsage(userId: string, feature: UsageFeature, apiCallDetails?: ApiCallDetails): Promise<void> {
  await pool.query(
    'INSERT INTO user_evt_usage (user_id, feature, api_call_details) VALUES ($1, $2, $3)',
    [userId, feature, apiCallDetails ? JSON.stringify(apiCallDetails) : null],
  );
}

const AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface RawUsageRow {
  id: string;
  user_id: string;
  feature: UsageFeature;
  month: string;
  api_call_details: ApiCallDetails | null;
}

function mergeCounts(base: ApiCallDetails | null, addition: ApiCallDetails): ApiCallDetails {
  const merged: ApiCallDetails = { ...(base ?? {}) };
  for (const [key, count] of Object.entries(addition)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

// Watermark-gated daily sweep (sys_usage_aggregation_watermark, migration 038) - rolls every raw
// user_evt_usage row older than 3 days into user_evt_usage_summary_monthly (both event_count and
// the cumulative api_call_details JSONB), then deletes those raw rows. This is the *only* place
// either summary column is written - logUsage() above is insert-only, so a brand-new
// (user, feature, month) triplet has no summary row at all until this sweep first runs for it
// (the Monthly tab's "data reflects until <cutoff>" banner exists to make that lag visible, not
// to hide it). Triggered fire-and-forget from auth.controller.ts's login() handler; the cheap
// watermark check below makes every login except the first one in a 24h window a single no-op
// read, regardless of how many users log in during that window (a global sweep, not a per-user
// one).
export async function maybeRunDailyUsageAggregation(): Promise<void> {
  const { rows: watermarkRows } = await pool.query<{ last_aggregated_at: Date | null }>(
    'SELECT last_aggregated_at FROM sys_usage_aggregation_watermark WHERE id = 1',
  );
  const lastAggregatedAt = watermarkRows[0]?.last_aggregated_at;
  if (lastAggregatedAt && Date.now() - lastAggregatedAt.getTime() < AGGREGATION_INTERVAL_MS) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // User Usage Dashboard (2026-09-05) needs a full 3 days of raw detail to exist for its
    // "Last 3 Days" ranking - so a row is only ever folded into the summary and deleted once
    // it's more than 3 days old, never while it's still inside that display window. Every row
    // this age is swept, whether or not it carries api_call_details - a plain event_count-only
    // row still represents one real function call that must be counted and cleared, not left to
    // linger until the 35-day TTL backstop.
    const { rows: rawRows } = await client.query<RawUsageRow>(
      `SELECT id, user_id, feature, date_trunc('month', created_at)::date AS month, api_call_details
       FROM user_evt_usage WHERE created_at < now() - interval '3 days' FOR UPDATE`,
    );

    if (rawRows.length > 0) {
      const grouped = new Map<string, { userId: string; feature: UsageFeature; month: string; eventCount: number; details: ApiCallDetails | null }>();
      for (const row of rawRows) {
        const key = `${row.user_id}|${row.feature}|${row.month}`;
        let group = grouped.get(key);
        if (!group) {
          group = { userId: row.user_id, feature: row.feature, month: row.month, eventCount: 0, details: null };
          grouped.set(key, group);
        }
        group.eventCount += 1;
        if (row.api_call_details) group.details = mergeCounts(group.details, row.api_call_details);
      }

      for (const { userId, feature, month, eventCount, details } of grouped.values()) {
        const { rows: summaryRows } = await client.query<{ event_count: number | string | null; api_call_details: ApiCallDetails | null }>(
          'SELECT event_count, api_call_details FROM user_evt_usage_summary_monthly WHERE user_id = $1 AND feature = $2 AND month = $3',
          [userId, feature, month],
        );
        const existing = summaryRows[0];
        const newEventCount = Number(existing?.event_count ?? 0) + eventCount;
        const newDetails = details ? mergeCounts(existing?.api_call_details ?? null, details) : (existing?.api_call_details ?? null);

        await client.query(
          `INSERT INTO user_evt_usage_summary_monthly (user_id, feature, month, event_count, api_call_details)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, feature, month)
           DO UPDATE SET event_count = $4, api_call_details = $5, updated_at = now()`,
          [userId, feature, month, newEventCount, newDetails ? JSON.stringify(newDetails) : null],
        );
      }

      // Delete exactly the rows locked/aggregated above, by id - not a bare re-evaluated
      // predicate. A concurrent logUsage() insert could otherwise land between the
      // SELECT ... FOR UPDATE snapshot and this DELETE, matching a blanket age-based predicate
      // and getting silently discarded without ever being aggregated into the summary.
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

// The sweep's own cutoff, exposed for the Monthly tab's "data reflects until <cutoff>" banner -
// always ~3 days behind whenever the sweep has run at least once. last_aggregated_at is
// NOT NULL, defaulting to the '2000-01-01' sentinel (migration 038) meaning "never run" - that
// sentinel maps to a null cutoff here rather than a nonsense 1999-12-29 banner.
export async function getUsageAggregationCutoff(): Promise<string | null> {
  const { rows } = await pool.query<{ cutoff: Date | null }>(
    `SELECT CASE WHEN last_aggregated_at <= '2000-01-01'::timestamptz THEN NULL
            ELSE last_aggregated_at - interval '3 days' END AS cutoff
     FROM sys_usage_aggregation_watermark WHERE id = 1`,
  );
  return rows[0]?.cutoff ? new Date(rows[0].cutoff).toISOString() : null;
}

// User Usage Dashboard (2026-09-05) - read side. Reports Function Calls (how many times a
// feature was invoked) and real external API volume split by provider (FMP vs Finnhub) as
// distinct numbers, rather than blending them into one score - two different metrics that can
// legitimately move in opposite directions (a handful of Refresh Prices clicks can cost far more
// API calls than dozens of Momentum runs).
export interface FeatureUsage {
  functionCalls: number;
  fmpCalls: number;
  finnhubCalls: number;
}

export interface UsageRankingEntry {
  userId: string;
  email: string;
  roles: string[];
  totalFunctionCalls: number;
  totalFmpCalls: number;
  totalFinnhubCalls: number;
  byFeature: Partial<Record<UsageFeature, FeatureUsage>>;
}

// Dashboard sub-tab (2026-09-09) needs to split users into "Admin/Admin-Master" vs everyone
// else, which the per-feature ranking query above has no reason to know about. Fetched as a
// separate, independent query rather than joined into that one - joining users_roles/m_roles
// in would multiply each user's feature rows by however many roles they hold, silently
// corrupting the FMP/Finnhub sums buildRanking() adds up below.
async function fetchRolesByUser(): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{ user_id: string; name: string }>(
    `SELECT ur.user_id::text AS user_id, r.name
     FROM users_roles ur
     JOIN m_roles r ON r.id = ur.role_id`,
  );
  const rolesByUser = new Map<string, string[]>();
  for (const { user_id, name } of rows) {
    const list = rolesByUser.get(user_id) ?? [];
    list.push(name);
    rolesByUser.set(user_id, list);
  }
  return rolesByUser;
}

function attachRoles(entries: UsageRankingEntry[], rolesByUser: Map<string, string[]>): UsageRankingEntry[] {
  for (const entry of entries) {
    entry.roles = rolesByUser.get(entry.userId) ?? [];
  }
  return entries;
}

function splitByProvider(details: ApiCallDetails | null): { fmp: number; finnhub: number } {
  let fmp = 0;
  let finnhub = 0;
  for (const [key, count] of Object.entries(details ?? {})) {
    if (key.startsWith('fmp')) fmp += count;
    else if (key.startsWith('finnhub')) finnhub += count;
  }
  return { fmp, finnhub };
}

function buildRanking(
  rows: { user_id: string; email: string; feature: UsageFeature | null; functionCalls: number; fmpCalls: number; finnhubCalls: number }[],
): UsageRankingEntry[] {
  const byUser = new Map<string, UsageRankingEntry>();
  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = { userId: row.user_id, email: row.email, roles: [], totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} };
      byUser.set(row.user_id, entry);
    }
    if (row.feature) {
      entry.totalFunctionCalls += row.functionCalls;
      entry.totalFmpCalls += row.fmpCalls;
      entry.totalFinnhubCalls += row.finnhubCalls;
      const existing = entry.byFeature[row.feature] ?? { functionCalls: 0, fmpCalls: 0, finnhubCalls: 0 };
      entry.byFeature[row.feature] = {
        functionCalls: existing.functionCalls + row.functionCalls,
        fmpCalls: existing.fmpCalls + row.fmpCalls,
        finnhubCalls: existing.finnhubCalls + row.finnhubCalls,
      };
    }
  }
  // Zero-usage users appear too (LEFT JOIN from users below) - sorted last, not hidden, so an
  // admin can also see who's been inactive. Ranked by combined real API volume (the actual cost
  // metric), not raw invocation count.
  return [...byUser.values()].sort((a, b) => (b.totalFmpCalls + b.totalFinnhubCalls) - (a.totalFmpCalls + a.totalFinnhubCalls));
}

// LEFT JOIN from users, not an inner join from the event table - a user with zero activity in
// the window must still appear (all-zero row), not be silently omitted from an audit view.
export async function getUsageRankingLast3Days(): Promise<UsageRankingEntry[]> {
  const [{ rows }, rolesByUser] = await Promise.all([
    pool.query<{ user_id: string; email: string; feature: UsageFeature | null; api_call_details: ApiCallDetails | null }>(
      `SELECT u.id AS user_id, u.email, ue.feature, ue.api_call_details
       FROM users u
       LEFT JOIN user_evt_usage ue ON ue.user_id = u.id AND ue.created_at >= now() - interval '3 days'`,
    ),
    fetchRolesByUser(),
  ]);
  const ranking = buildRanking(rows.map((r) => {
    const { fmp, finnhub } = splitByProvider(r.api_call_details);
    return {
      user_id: r.user_id, email: r.email, feature: r.feature,
      functionCalls: r.feature ? 1 : 0, fmpCalls: r.feature ? fmp : 0, finnhubCalls: r.feature ? finnhub : 0,
    };
  }));
  return attachRoles(ranking, rolesByUser);
}

// Dashboard sub-tab's per-card day picker (2026-09-12) - a single calendar day's ranking,
// distinct from both the rolling 3-day window above and the monthly summary below. 0 = today,
// 1 = yesterday, 2 = day before yesterday. Always safe to read straight from the raw
// user_evt_usage log: the daily sweep (maybeRunDailyUsageAggregation) only ever deletes rows
// older than 3 days, and the oldest possible row in "day before yesterday" is at most ~72
// hours old, never past that cutoff. date_trunc('day', now()) truncates to the DB session's
// timezone (UTC, same assumption the month-level date_trunc('month', ...) elsewhere relies on).
export type UsageDayOffset = 0 | 1 | 2;

export async function getUsageRankingForDay(dayOffset: UsageDayOffset): Promise<UsageRankingEntry[]> {
  const [{ rows }, rolesByUser] = await Promise.all([
    pool.query<{ user_id: string; email: string; feature: UsageFeature | null; api_call_details: ApiCallDetails | null }>(
      `SELECT u.id AS user_id, u.email, ue.feature, ue.api_call_details
       FROM users u
       LEFT JOIN user_evt_usage ue ON ue.user_id = u.id
         AND ue.created_at >= date_trunc('day', now()) - ($1 || ' days')::interval
         AND ue.created_at < date_trunc('day', now()) - ($1 || ' days')::interval + interval '1 day'`,
      [dayOffset],
    ),
    fetchRolesByUser(),
  ]);
  const ranking = buildRanking(rows.map((r) => {
    const { fmp, finnhub } = splitByProvider(r.api_call_details);
    return {
      user_id: r.user_id, email: r.email, feature: r.feature,
      functionCalls: r.feature ? 1 : 0, fmpCalls: r.feature ? fmp : 0, finnhubCalls: r.feature ? finnhub : 0,
    };
  }));
  return attachRoles(ranking, rolesByUser);
}

export async function getUsageRankingForMonth(month: string): Promise<UsageRankingEntry[]> {
  const [{ rows }, rolesByUser] = await Promise.all([
    pool.query<{
      user_id: string; email: string; feature: UsageFeature | null;
      event_count: number | string | null; api_call_details: ApiCallDetails | null;
    }>(
      `SELECT u.id AS user_id, u.email, s.feature, s.event_count, s.api_call_details
       FROM users u
       LEFT JOIN user_evt_usage_summary_monthly s ON s.user_id = u.id AND s.month = $1`,
      [month],
    ),
    fetchRolesByUser(),
  ]);
  const ranking = buildRanking(rows.map((r) => {
    const { fmp, finnhub } = splitByProvider(r.api_call_details);
    return {
      user_id: r.user_id, email: r.email, feature: r.feature,
      functionCalls: r.feature ? Number(r.event_count ?? 0) : 0, fmpCalls: r.feature ? fmp : 0, finnhubCalls: r.feature ? finnhub : 0,
    };
  }));
  return attachRoles(ranking, rolesByUser);
}

// Populates the Monthly sub-tab's month picker - only months with at least one real row (the
// current month is always selectable client-side regardless, degrading to an all-zero view).
export async function getAvailableUsageMonths(): Promise<string[]> {
  // month::text, not a bare SELECT - node-postgres parses a DATE column into a JS Date at the
  // server's local midnight, and JSON-serializing that Date shifts it to a non-midnight UTC
  // timestamp (e.g. '2026-09-01T04:00:00.000Z') - which then never string-matches the frontend's
  // plain 'YYYY-MM-01' currentMonth(), wrongly tricking its "is the current month already in the
  // list" check into re-adding a duplicate. Casting to text in SQL returns the plain date string
  // directly, sidestepping the Date round-trip (and its timezone shift) entirely.
  const { rows } = await pool.query<{ month: string }>(
    'SELECT DISTINCT month::text AS month FROM user_evt_usage_summary_monthly ORDER BY month DESC',
  );
  return rows.map((r) => r.month);
}
