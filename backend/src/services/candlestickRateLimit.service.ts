// Per-user rate limit on real (cache-miss) candlestick fetches - one total budget across every
// symbol/interval combined, admin-tunable via Config Properties (migration 044), enforced by
// counting this user's own 'stock_analysis_candlestick' rows in user_evt_usage over the
// configured trailing window - reusing the existing usage-tracking log rather than a new counter
// table (raw rows are kept 3 days before the daily sweep, comfortably covering any realistic
// window here).

import { pool } from '../db/pool';
import { getConfigInt } from './configProperty.service';

const DEFAULT_MAX_NEW_REQUESTS = 10;
const DEFAULT_WINDOW_MINUTES = 10;

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  windowMinutes: number;
  usedInWindow: number;
}

export async function checkCandlestickRateLimit(userId: string): Promise<RateLimitStatus> {
  const [limit, windowMinutes] = await Promise.all([
    getConfigInt('stock_analysis_candlestick_max_new_requests', DEFAULT_MAX_NEW_REQUESTS),
    getConfigInt('stock_analysis_candlestick_window_minutes', DEFAULT_WINDOW_MINUTES),
  ]);
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM user_evt_usage
     WHERE user_id = $1 AND feature = 'stock_analysis_candlestick' AND created_at > now() - ($2 || ' minutes')::interval`,
    [userId, windowMinutes],
  );
  const usedInWindow = Number(rows[0].count);
  return { allowed: usedInWindow < limit, limit, windowMinutes, usedInWindow };
}
