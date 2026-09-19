import { Request, Response, NextFunction } from 'express';
import * as candlestickService from '../services/candlestick.service';
import * as userSubscription from '../services/userSubscription.service';
import { CANDLESTICK_INTERVALS, type CandlestickInterval } from '../services/candlestick.service';

// This route sits behind requireAuth (see app.ts), so req.user is always populated by the time
// this handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

function parseInterval(raw: unknown): CandlestickInterval | null {
  return typeof raw === 'string' && (CANDLESTICK_INTERVALS as string[]).includes(raw) ? (raw as CandlestickInterval) : null;
}

export async function getCachedSymbols(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const symbols = await candlestickService.listCachedSymbols();
    res.json({ symbols });
  } catch (err) {
    next(err);
  }
}

// Read-only - never calls FMP. 404 (not an empty body) when this (symbol, interval) has never
// been cached, so the frontend can distinguish "nothing here yet, show the confirm-to-fetch
// prompt" from a genuine server error.
export async function getSnapshot(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const interval = parseInterval(req.params.interval);
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }
  if (!interval) {
    res.status(400).json({ error: `interval must be one of: ${CANDLESTICK_INTERVALS.join(', ')}` });
    return;
  }
  try {
    const snapshot = await candlestickService.getSnapshot(symbol, interval);
    if (!snapshot) {
      res.status(404).json({ error: 'No cached data for this symbol/interval yet.' });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
}

// The explicit, confirmed action - the only path that ever makes a real FMP call for this
// feature, gated by the per-user rate limit.
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  const interval = parseInterval(req.params.interval);
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }
  if (!interval) {
    res.status(400).json({ error: `interval must be one of: ${CANDLESTICK_INTERVALS.join(', ')}` });
    return;
  }
  try {
    const snapshot = await candlestickService.refresh(symbol, interval, getUserId(req));
    res.json(snapshot);
  } catch (err) {
    if (err instanceof candlestickService.CandlestickRateLimitExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
