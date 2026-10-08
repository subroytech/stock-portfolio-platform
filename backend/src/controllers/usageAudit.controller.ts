import { Request, Response, NextFunction } from 'express';
import * as usageTracking from '../services/usageTracking.service';

const MONTH_RE = /^\d{4}-\d{2}-01$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7) + '-01';
}

// GET /usage-audit/last-3-days - the User Usage Dashboard's default landing view
// (requirePermission('usage_audit:view') in usageAudit.routes.ts).
export async function getLast3Days(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ranking = await usageTracking.getUsageRankingLast3Days();
    res.json({ ranking });
  } catch (err) {
    next(err);
  }
}

const VALID_DAY_OFFSETS = [0, 1, 2];

// GET /usage-audit/day?offset=0|1|2 - a single calendar day's ranking (0=today, 1=yesterday,
// 2=day before yesterday), backing the Dashboard sub-tab's per-card day picker.
export async function getDay(req: Request, res: Response, next: NextFunction): Promise<void> {
  const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : NaN;
  if (!VALID_DAY_OFFSETS.includes(offset)) {
    res.status(400).json({ error: 'offset must be 0 (today), 1 (yesterday), or 2 (day before yesterday).' });
    return;
  }
  try {
    const ranking = await usageTracking.getUsageRankingForDay(offset as usageTracking.UsageDayOffset);
    res.json({ offset, ranking });
  } catch (err) {
    next(err);
  }
}

// GET /usage-audit/monthly?month=YYYY-MM-01 - defaults to the current month when omitted.
export async function getMonthly(req: Request, res: Response, next: NextFunction): Promise<void> {
  const month = typeof req.query.month === 'string' ? req.query.month : currentMonth();
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: 'month must be in YYYY-MM-01 format.' });
    return;
  }
  try {
    const [ranking, dataCutoff] = await Promise.all([
      usageTracking.getUsageRankingForMonth(month),
      usageTracking.getUsageAggregationCutoff(),
    ]);
    res.json({ month, ranking, dataCutoff });
  } catch (err) {
    next(err);
  }
}

// GET /usage-audit/available-months - populates the Monthly sub-tab's month picker.
export async function getAvailableMonths(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const months = await usageTracking.getAvailableUsageMonths();
    res.json({ months });
  } catch (err) {
    next(err);
  }
}
