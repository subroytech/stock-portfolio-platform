import { Request, Response, NextFunction } from 'express';
import * as cf from '../services/contrarianFinder.service';
import * as userSubscription from '../services/userSubscription.service';

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// Clamps a request-supplied number into [min, max], falling back to
// `fallback` when the input is missing/non-numeric — matches the intent of
// the source app's fixed dropdowns without removing the rebuild's added
// flexibility of free-number inputs.
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// One batch per request — the frontend orchestrates the full scan by calling
// this repeatedly (batchIndex 0, 1, 2, ...), pacing itself between calls to
// respect FMP's rate limits, and stopping the moment `totalBatches` is
// reached. This replaces the old single `/scan` endpoint that ran every
// batch + a server-side sleep() inside one long-held request — no server
// state/session needed, since assembleUniverse()/buildBatches() are pure and
// (now that fetchConstituents() has an ORDER BY) deterministic across
// repeated calls in the same scan, so recomputing them fresh per batch is
// cheap and always agrees on the same batch plan.
export async function scanBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { batchIndex, batchSize, maxBatches, qualityPreset, scanDays } = req.body || {};

  const clampedBatchSize = clamp(batchSize, 10, 250, cf.CF_BATCH);
  const clampedMaxBatches = clamp(maxBatches, 1, 10, cf.CF_MAX_BATCHES);
  const clampedScanDays = clamp(scanDays, 1, 30, 7);
  const idx = typeof batchIndex === 'number' ? batchIndex : parseInt(String(batchIndex), 10);

  try {
    const key = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');
    const universe = await cf.assembleUniverse();
    const batches = cf.buildBatches(universe, clampedBatchSize, clampedMaxBatches);

    if (!Number.isInteger(idx) || idx < 0 || idx >= batches.length) {
      res.status(400).json({ error: `batchIndex must be an integer between 0 and ${batches.length - 1}.` });
      return;
    }

    const quality = cf.resolveQuality(qualityPreset);
    const results = await cf.scanBatch(batches[idx], key, quality, clampedScanDays);
    res.json({ batchIndex: idx, totalBatches: batches.length, universeSize: universe.length, results });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
