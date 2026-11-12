import { Request, Response, NextFunction } from 'express';
import { checkFmpRateLimit } from '../services/fmpRateLimit.service';

// This route sits behind requireAuth (see app.ts), so req.user is always populated by the time
// this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// "My own" status - requireAuth only, no special permission, same boundary as e.g.
// GET /flex-quota/status - a user's own account data, not an admin action. Backs the header
// rate-limit indicator (green "(i)"/red "W" badges).
export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rateLimit = await checkFmpRateLimit(getUserId(req));
    res.json({
      exempt: rateLimit.exempt,
      limit: rateLimit.limit,
      windowMinutes: rateLimit.windowMinutes,
      usedInWindow: rateLimit.usedInWindow,
      remaining: rateLimit.exempt ? null : Math.max(0, rateLimit.limit - rateLimit.usedInWindow),
    });
  } catch (err) {
    next(err);
  }
}
