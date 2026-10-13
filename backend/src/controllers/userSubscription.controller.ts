import { Request, Response, NextFunction } from 'express';
import * as userSubscriptionService from '../services/userSubscription.service';
import * as llmProviderModels from '../services/llmProviderModels.service';

// Application-level allowlist, not a DB constraint — adding a new provider
// later is a one-line change here, no migration needed.
const ALLOWED_PROVIDERS = ['fmp', 'finnhub', 'anthropic', 'openai'];

// "Get Allowed Models" only makes sense for providers with a model catalog of their own - FMP/
// Finnhub are data providers, not LLM providers, and have no equivalent concept.
const MODEL_LISTING_PROVIDERS: llmProviderModels.LlmProvider[] = ['anthropic', 'openai'];

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

// Tests either the key currently being typed/pasted (the default), or - when `useSavedKey:
// true` is explicitly passed - the caller's own already-saved key, decrypted server-side and
// never returned to the client (only the resulting model list is). Deliberately an explicit
// flag rather than "empty apiKey means use the saved one" - an accidental fallback here would
// silently test the wrong key. Uses getOwnDecryptedKey(), not getDecryptedKey() - this must
// never silently fall through to the Admin-Master Fallback key, since a user clicking "check MY
// saved key" should see results for the key they themselves configured, not an admin's key they
// may not even know exists. apiKey (when present) is accepted in the body, never a query
// string/URL, same as upsert() above, so it's never written to a server log.
export async function listModels(req: Request, res: Response, next: NextFunction): Promise<void> {
  const provider = getProviderParam(req);
  if (!MODEL_LISTING_PROVIDERS.includes(provider as llmProviderModels.LlmProvider)) {
    res.status(400).json({ error: `Listing models is only supported for: ${MODEL_LISTING_PROVIDERS.join(', ')}.` });
    return;
  }

  let apiKey: string;
  if (req.body?.useSavedKey === true) {
    const saved = await userSubscriptionService.getOwnDecryptedKey(getUserId(req), provider);
    if (!saved) {
      res.status(400).json({ error: `No ${provider} key is saved yet - add one first, or paste one above to test it directly.` });
      return;
    }
    apiKey = saved;
  } else {
    apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey) {
      res.status(400).json({ error: 'An API key is required.' });
      return;
    }
  }

  try {
    const models = await llmProviderModels.listModelsForProvider(provider as llmProviderModels.LlmProvider, apiKey);
    res.json({ models });
  } catch (err) {
    if (err instanceof llmProviderModels.ProviderModelListError) {
      res.status(400).json({ error: err.message });
      return;
    }
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
