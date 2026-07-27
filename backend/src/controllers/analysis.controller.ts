import { Request, Response, NextFunction } from 'express';
import * as analysisService from '../services/analysisService';
import * as longTermAnalysisData from '../services/longTermAnalysisData.service';
import * as userSubscription from '../services/userSubscription.service';

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

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// Node owns every external call (FMP + Finnhub) and the user's decrypted
// keys; Python only ever sees the assembled payload and does pure
// computation — see Architecture.md Section 3 item 2 for the full
// data-ownership rationale.
export async function longTermAnalysis(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbolParam = req.params.symbol;
  const symbol = (Array.isArray(symbolParam) ? symbolParam[0] : symbolParam || '').trim().toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }

  try {
    const userId = getUserId(req);
    const fmpKey = await userSubscription.getDecryptedKey(userId, 'fmp');

    // Finnhub news is optional — matches the source app's treatment of news
    // as a soft, non-blocking enhancement. A user with no Finnhub key on
    // file still gets a full report, just with an empty news list.
    let finnhubKey: string | undefined;
    try {
      finnhubKey = await userSubscription.getDecryptedKey(userId, 'finnhub');
    } catch (err) {
      if (!(err instanceof userSubscription.MissingUserApiKeyError)) throw err;
    }

    const rawData = await longTermAnalysisData.fetchLongTermAnalysisData(symbol, fmpKey, finnhubKey);
    const result = await analysisService.computeLongTermAnalysis(rawData);
    res.json(result);
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
