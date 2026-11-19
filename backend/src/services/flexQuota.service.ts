// Flex Portfolio Quota Limits (Phase 4). Resolves the *effective* limit for a given user -
// their own per-user override (users.flex_max_..._override, migration 039) if set, otherwise
// the global default (Config Properties, same migration). One small named function per limit,
// matching users.service.ts's updateUserEmail/updateUserStatus convention rather than a single
// generic parameterized resolver with an interpolated column name.

import { pool } from '../db/pool';
import { getConfigInt } from './configProperty.service';

export async function getEffectivePendingTemplateLimit(userId: string): Promise<number> {
  const { rows } = await pool.query<{ flex_max_pending_templates_override: number | null }>(
    'SELECT flex_max_pending_templates_override FROM users WHERE id = $1',
    [userId],
  );
  const override = rows[0]?.flex_max_pending_templates_override;
  if (override != null) return Number(override);
  return getConfigInt('portfolio_flex_max_pending_templates', 2);
}

export async function getEffectiveApprovedTemplateLimit(userId: string): Promise<number> {
  const { rows } = await pool.query<{ flex_max_approved_templates_override: number | null }>(
    'SELECT flex_max_approved_templates_override FROM users WHERE id = $1',
    [userId],
  );
  const override = rows[0]?.flex_max_approved_templates_override;
  if (override != null) return Number(override);
  return getConfigInt('portfolio_flex_max_approved_templates', 5);
}

export async function getEffectivePortfolioLimit(userId: string): Promise<number> {
  const { rows } = await pool.query<{ flex_max_portfolios_override: number | null }>(
    'SELECT flex_max_portfolios_override FROM users WHERE id = $1',
    [userId],
  );
  const override = rows[0]?.flex_max_portfolios_override;
  if (override != null) return Number(override);
  return getConfigInt('portfolio_flex_max_portfolios', 6);
}
