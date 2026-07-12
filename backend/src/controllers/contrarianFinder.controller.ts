import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';
import * as cf from '../services/contrarianFinder.service';

export async function scan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const {
    threshold = 25,
    batchSize,
    maxBatches,
    qualityPreset,
    scanDays,
  } = req.body || {};

  try {
    const key = marketData.requireFmpKey();
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
    if (err instanceof marketData.MissingApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
