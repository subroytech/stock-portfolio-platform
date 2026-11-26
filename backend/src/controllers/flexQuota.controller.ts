import { Request, Response, NextFunction } from 'express';
import * as flexQuota from '../services/flexQuota.service';
import * as portfolioTemplateService from '../services/portfolioTemplate.service';
import * as portfolioService from '../services/portfolio.service';

function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// GET /flex-quota/status - "my own" quota status, so the Flex wizard/Save Template UI can show
// a live current/limit indicator and disable submission before a 409 would fire, instead of
// only explaining it after. Orchestrated here (not inside flexQuota.service.ts itself) to
// avoid a circular import - portfolioTemplate.service.ts and portfolio.service.ts both already
// import flexQuota.service.ts for the effective-limit resolvers.
export async function getMyQuotaStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getUserId(req);
    const [pendingLimit, approvedLimit, portfolioLimit, templateCounts, portfolioCount] = await Promise.all([
      flexQuota.getEffectivePendingTemplateLimit(userId),
      flexQuota.getEffectiveApprovedTemplateLimit(userId),
      flexQuota.getEffectivePortfolioLimit(userId),
      portfolioTemplateService.countTemplatesByStatus(userId),
      portfolioService.countFlexPortfolios(userId),
    ]);
    res.json({
      pendingTemplates: { current: templateCounts.pending, limit: pendingLimit },
      approvedTemplates: { current: templateCounts.approved, limit: approvedLimit },
      flexPortfolios: { current: portfolioCount, limit: portfolioLimit },
    });
  } catch (err) {
    next(err);
  }
}
