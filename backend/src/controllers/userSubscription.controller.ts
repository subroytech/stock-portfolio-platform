import { Request, Response, NextFunction } from 'express';
import * as userSubscriptionService from '../services/userSubscription.service';

// Application-level allowlist, not a DB constraint — adding a new provider
// later is a one-line change here, no migration needed.
const ALLOWED_PROVIDERS = ['fmp', 'finnhub'];

// Every route this controller serves sits behind requireAuth (see app.ts), so
// req.user is always populated by the time a handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// req.params.provider types as string | string[] (Express allows array route
// params in some configurations); a bare :provider segment is always a
// single string at runtime, this just satisfies the type checker.
function getProviderParam(req: Request): string {
  const raw = req.params.provider;
  return Array.isArray(raw) ? raw[0] : raw;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const subscriptions = await userSubscriptionService.listSubscriptions(getUserId(req));
    res.json({ subscriptions });
  } catch (err) {
    next(err);
  }
}

export async function upsert(req: Request, res: Response, next: NextFunction): Promise<void> {
  const provider = getProviderParam(req);
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Unrecognized provider "${provider}". Supported: ${ALLOWED_PROVIDERS.join(', ')}.` });
    return;
  }

  const { apiKey, planTier, status, renewalDate } = req.body || {};
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    res.status(400).json({ error: 'An API key is required.' });
    return;
  }

  try {
    const subscription = await userSubscriptionService.upsertSubscription(getUserId(req), provider, {
      apiKey: apiKey.trim(),
      planTier: typeof planTier === 'string' ? planTier : null,
      status: typeof status === 'string' && status.trim() ? status : 'active',
      renewalDate: typeof renewalDate === 'string' ? renewalDate : null,
    });
    res.json({ subscription });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const provider = getProviderParam(req);
  try {
    const deleted = await userSubscriptionService.deleteSubscription(getUserId(req), provider);
    if (!deleted) {
      res.status(404).json({ error: 'Subscription not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
