import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';
import * as userSubscription from '../services/userSubscription.service';
import * as usageTracking from '../services/usageTracking.service';

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
    const userId = getUserId(req);
    const apiKey = await userSubscription.getDecryptedKey(userId, 'fmp');
    const { quotes, realCalls } = await marketData.getQuotes(symbols, apiKey);
    // getQuotes() now routes through the shared daily FMP cache (2026-09-12) - realCalls
    // reflects only the symbols that weren't already cached today, not a flat per-symbol count.
    usageTracking.logUsage(userId, 'quotes', { fmp_quote: realCalls })
      .catch((e) => console.error('usage log failed', e));
    res.json({ quotes });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
