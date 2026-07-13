import { Request, Response, NextFunction } from 'express';
import * as cf from '../services/contrarianFinder.service';
import * as userSubscription from '../services/userSubscription.service';

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

export async function scan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const {
    threshold = 25,
    batchSize,
    maxBatches,
    qualityPreset,
    scanDays,
  } = req.body || {};

  try {
    const key = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');
    const { universeSize, scanned, results } = await cf.runScan({
      key,
      batchSize: batchSize ? parseInt(batchSize, 10) : undefined,
      maxBatches: maxBatches ? parseInt(maxBatches, 10) : undefined,
      qualityPreset,
      scanDays: scanDays ? parseInt(scanDays, 10) : undefined,
    });
    const candidates = cf.filterCandidates(results, parseInt(threshold, 10) || 25);
    res.json({ universeSize, scanned, threshold: parseInt(threshold, 10) || 25, candidates });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
