// All-encompassing per-user rate limit on real FMP/Finnhub calls, covering every ad-hoc
// single-lookup feature: Candlestick, Stock Preview, Momentum, Long-Term Analysis, and
// Contrarian Comeback (deliberately NOT portfolio_refresh/contrarian_finder_scan/quotes - those
// are batch-style actions with very different call-volume shapes, left for a future pass).
// Renamed/generalized 2026-09-19 from candlestickRateLimit.service.ts, which only covered
// Candlestick on its own - one shared budget across all five features now, admin-tunable via the
// same Config Properties (migration 044, renamed 045/046).
//
// admin/admin-master are fully exempt, checked by literal role name (not a permission key - a
// deliberate exception, same style as portfolioTemplate.service.ts's own literal
// ('admin', 'admin-master') check) - short-circuits before any config/usage query, so the
// exemption costs those roles nothing.
//
// usedInWindow is the SUM of real calls logged, not a count of qualifying rows - a real bug
// found live 2026-09-19 (user review, before this ever shipped): the first version counted 1 per
// row with at least one nonzero apiCallDetails value, which is only correct by coincidence for
// features where 1 request == 1 real call (Candlestick, roughly Momentum/Stock Preview too).
// Long-Term Analysis logs ~16 real calls in ONE row, Contrarian Comeback ~10 - row-counting would
// have let a handful of expensive requests blow far past the real API cost this limit exists to
// bound, while still displaying as if barely used. Sums every real (nonzero) apiCallDetails value
// per matching row instead - same "real cost, not event count" convention
// usageTracking.service.ts's own Usage Audit ranking already established for exactly this reason;
// this should have reused it from the start. Cache hits still contribute 0 (every value is 0),
// so they still stay free. Summed in application code rather than SQL to avoid relying on
// CockroachDB's JSONB function support for a query this small - each user's own recent activity
// in the window is never more than a few dozen rows.

import { pool } from '../db/pool';
import { getConfigInt } from './configProperty.service';
import { getUserRoles } from './roles.service';

const DEFAULT_MAX_NEW_REQUESTS = 10;
const DEFAULT_WINDOW_MINUTES = 10;
const EXEMPT_ROLES = ['admin', 'admin-master'];
const RATE_LIMITED_FEATURES = ['stock_analysis_candlestick', 'stock_preview', 'momentum', 'long_term_analysis', 'contrarian_comeback'];

export class FmpRateLimitExceededError extends Error {}

export interface RateLimitStatus {
  allowed: boolean;
  exempt: boolean;
  limit: number;
  windowMinutes: number;
  usedInWindow: number;
}

export async function checkFmpRateLimit(userId: string): Promise<RateLimitStatus> {
  const roles = await getUserRoles(userId);
  if (roles.some((role) => EXEMPT_ROLES.includes(role))) {
    return { allowed: true, exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0 };
  }

  const [limit, windowMinutes] = await Promise.all([
    getConfigInt('stock_analysis_candlestick_max_new_requests', DEFAULT_MAX_NEW_REQUESTS),
    getConfigInt('stock_analysis_candlestick_window_minutes', DEFAULT_WINDOW_MINUTES),
  ]);

  const { rows } = await pool.query<{ api_call_details: Record<string, number> | null }>(
    `SELECT api_call_details FROM user_evt_usage
     WHERE user_id = $1 AND feature = ANY($2) AND created_at > now() - ($3 || ' minutes')::interval`,
    [userId, RATE_LIMITED_FEATURES, windowMinutes],
  );
  const usedInWindow = rows.reduce(
    (sum, row) => sum + Object.values(row.api_call_details ?? {}).reduce((rowSum, value) => rowSum + Math.max(Number(value), 0), 0),
    0,
  );

  return { allowed: usedInWindow < limit, exempt: false, limit, windowMinutes, usedInWindow };
}
