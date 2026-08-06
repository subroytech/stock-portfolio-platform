import { Request, Response, NextFunction } from 'express';
import * as cf from '../services/contrarianFinder.service';
import * as analysisService from '../services/analysisService';
import * as userSubscription from '../services/userSubscription.service';
import * as usageTracking from '../services/usageTracking.service';
import * as rolesService from '../services/roles.service';

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

// Read-only reference data (what a scan's universe actually contains), not an
// action - deliberately not requirePermission-gated, unlike scanBatch below.
// No FMP call / user API key needed either, so this doesn't even need
// getUserId(req).
export async function getUniverse(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const universe = await cf.getUniverseTable();
    res.json(universe);
  } catch (err) {
    next(err);
  }
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
//
// `updateAllTickerData: true` ("Run Scan (+ Mkt Cap)") piggybacks
// refreshTickerDataBatch(..., 'all') onto this same batch/pacing, refreshing
// every symbol in the batch's m_tickers row regardless of current state -
// omitted/undefined `tickerRefresh` in the response when the flag isn't set,
// so a normal "Run Scan" response shape is unchanged.
export async function scanBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { batchIndex, batchSize, maxBatches, qualityPreset, scanDays, updateAllTickerData } = req.body || {};

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
    const [results, tickerRefresh] = await Promise.all([
      cf.assembleScanBatch(batches[idx], key, quality, clampedScanDays),
      updateAllTickerData === true ? cf.refreshTickerDataBatch(batches[idx], key, 'all') : Promise.resolve(undefined),
    ]);
    usageTracking.logUsage(getUserId(req), 'contrarian_finder_scan').catch((e) => console.error('usage log failed', e));
    res.json({ batchIndex: idx, totalBatches: batches.length, universeSize: universe.length, results, tickerRefresh });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof analysisService.AnalysisServiceError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// Lighter sibling of scanBatch above - used only by the Admin Console's
// Master Data "Delta Update" action. Same universe/batch composition (fresh
// per call, deterministic), but skips quote/historical/scoring entirely -
// only refreshTickerDataBatch(..., 'missing') runs, so each batch is much
// faster than a real scan batch.
export async function tickerDataRefreshBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { batchIndex, batchSize, maxBatches } = req.body || {};

  const clampedBatchSize = clamp(batchSize, 10, 250, cf.CF_BATCH);
  const clampedMaxBatches = clamp(maxBatches, 1, 10, cf.CF_MAX_BATCHES);
  const idx = typeof batchIndex === 'number' ? batchIndex : parseInt(String(batchIndex), 10);

  try {
    const key = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');
    const universe = await cf.assembleUniverse();
    const batches = cf.buildBatches(universe, clampedBatchSize, clampedMaxBatches);

    if (!Number.isInteger(idx) || idx < 0 || idx >= batches.length) {
      res.status(400).json({ error: `batchIndex must be an integer between 0 and ${batches.length - 1}.` });
      return;
    }

    const { updated, skipped } = await cf.refreshTickerDataBatch(batches[idx], key, 'missing');
    res.json({ batchIndex: idx, totalBatches: batches.length, universeSize: universe.length, updated, skipped });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// Persists the results of a scan the caller just finished running client-side
// (see api/contrarianFinder.ts's useContrarianBatchScan) - fire-and-forget
// from the frontend's perspective, called once at the very end of a
// successfully completed scan. requirePermission('contrarian_finder:scan')
// at the route level - only someone who could run a scan should be able to
// claim to have completed one.
//
// Tiered retention (2026-08-05): contrarian_finder:scan_history distinguishes
// admin/admin-master from every other contrarian_finder:scan-permitted role
// (user-contra-withKey/wokey) - a dedicated permission rather than a
// hardcoded role-name check, resolved fresh per request same as
// requirePermission does (no caching on the JWT).
export async function saveLastScan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { universeSize, scanned, params, results } = req.body || {};

  if (typeof universeSize !== 'number' || typeof scanned !== 'number' || !Array.isArray(results)) {
    res.status(400).json({ error: 'universeSize and scanned must be numbers, results must be an array.' });
    return;
  }

  try {
    const userId = getUserId(req);
    const permissions = await rolesService.getUserPermissions(userId);
    const runTier: cf.ContrarianRunTier = permissions.includes('contrarian_finder:scan_history') ? 'admin' : 'user';
    await cf.saveLastScan(userId, runTier, { universeSize, scanned, params, results });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// Read-only, visible to everyone (like getUniverse above) - regular users who
// can't run a scan themselves still need to see the last one someone else
// ran. Returns { lastScan: null } rather than 404 when nothing's been saved
// yet, so the frontend can treat "no last scan" as a normal, not-an-error state.
export async function getLastScan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lastScan = await cf.getLastScan();
    res.json({ lastScan });
  } catch (err) {
    next(err);
  }
}
