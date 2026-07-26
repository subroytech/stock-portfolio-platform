import { Request, Response, NextFunction } from 'express';
import * as analysisService from '../services/analysisService';

// Thin proxy round-trip: Node (auth-checked) -> Python analysis-service ->
// back through Node. No real analysis logic yet — see Architecture.md
// Section 2/3 for what lands behind this once the Python service grows.
export async function health(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analysisService.checkHealth();
    res.json(result);
  } catch (err) {
    if (err instanceof analysisService.AnalysisServiceError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
