import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';
import * as userSubscription from '../services/userSubscription.service';

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// Thin proxy: returns the raw quote + historical series for a symbol. Unlike
// momentum.controller.ts, there's no real derivation to do server-side — the
// period-return math (Ported from js/stock-preview-chart.js's
// computeReturns()) is presentational and stays client-side.
export async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbolParam = req.params.symbol;
  const symbol = (Array.isArray(symbolParam) ? symbolParam[0] : symbolParam || '').trim().toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }

  try {
    const key = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');

    const [quoteResult, histResult] = await Promise.allSettled([
      marketData.getQuotes([symbol], key),
      marketData.getHistorical(symbol, key, 96),
    ]);

    if (histResult.status === 'rejected') throw histResult.reason;
    const hist = [...histResult.value].sort(
      (a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime(),
    );

    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value[symbol] : undefined;

    res.json({ symbol, quote: quote ?? null, historical: hist });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
