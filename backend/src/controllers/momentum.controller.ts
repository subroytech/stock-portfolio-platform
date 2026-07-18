import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';
import * as momentum from '../services/momentum.service';
import * as userSubscription from '../services/userSubscription.service';

// This route sits behind requireAuth (see app.ts), so req.user is always
// populated by the time this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

export async function analyze(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbolParam = req.params.symbol;
  const symbol = (Array.isArray(symbolParam) ? symbolParam[0] : symbolParam || '').trim().toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }

  try {
    const key = await userSubscription.getDecryptedKey(getUserId(req), 'fmp');

    const [histResult, quoteResult] = await Promise.allSettled([
      marketData.getHistorical(symbol, key, 130),
      marketData.getQuotes([symbol], key),
    ]);

    if (histResult.status === 'rejected') throw histResult.reason;
    const hist = [...histResult.value].sort(
      (a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime(),
    );

    const closes = hist.map((d) => parseFloat(String(d.close))).filter((v) => !isNaN(v));
    const lows = hist.map((d) => parseFloat(String(d.low))).filter((v) => !isNaN(v));
    const volumes = hist.map((d) => Math.max(parseInt(String(d.volume)) || 0, 0));

    if (closes.length < 30) {
      res.status(400).json({ error: `Only ${closes.length} trading days available for ${symbol} — need at least 30.` });
      return;
    }

    // Live quote is best-effort — a failure here shouldn't block the analysis.
    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value[symbol] : undefined;
    const price = quote?.price ?? closes[0];

    const analysis = momentum.assembleMomentumAnalysis(closes, lows, volumes, price);
    res.json({ symbol, name: quote?.name ?? null, analysis });
  } catch (err) {
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
