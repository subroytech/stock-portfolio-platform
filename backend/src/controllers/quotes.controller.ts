import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';
import * as userSubscription from '../services/userSubscription.service';

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

export async function getQuotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbolsParam = req.query.symbols;
  if (!symbolsParam || typeof symbolsParam !== 'string') {
    res.status(400).json({ error: 'Query param "symbols" is required, e.g. ?symbols=AAPL,MSFT' });
    return;
  }
  const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    res.status(400).json({ error: 'No valid symbols provided.' });
    return;
  }

  try {
    const apiKey = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');
    const quotes = await marketData.getQuotes(symbols, apiKey);
    res.json({ quotes });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
