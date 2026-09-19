import { Request, Response, NextFunction } from 'express';
import * as analysisService from '../services/analysisService';
import * as longTermAnalysisData from '../services/longTermAnalysisData.service';
import * as contrarianComebackData from '../services/contrarianComebackData.service';
import * as contrarianComebackCache from '../services/contrarianComebackCache';
import * as userSubscription from '../services/userSubscription.service';
import * as usageTracking from '../services/usageTracking.service';
import { InvalidTickerError } from '../utils/errors';

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

    const { apiCallCounts, ...rawData } = await longTermAnalysisData.fetchLongTermAnalysisData(symbol, fmpKey, finnhubKey);
    const result = await analysisService.computeLongTermAnalysis(rawData);
    // Bucketed by provider, not by individual endpoint name - this feature calls ~10
    // different FMP endpoints per run (profile/quote/income-statement/earnings/etc., plus a
    // variable number of peer lookups), so a per-endpoint breakdown would be noisy without
    // adding real signal over a simple provider-level total.
    usageTracking.logUsage(userId, 'long_term_analysis', apiCallCounts)
      .catch((e) => console.error('usage log failed', e));
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
    if (err instanceof InvalidTickerError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

function getSymbolParam(req: Request): string {
  const symbolParam = req.params.symbol;
  return (Array.isArray(symbolParam) ? symbolParam[0] : symbolParam || '').trim().toUpperCase();
}

// Resolves the FMP key (required) + Finnhub key (optional, soft-fails to
// undefined) for the calling user - same pattern longTermAnalysis() above uses.
async function resolveKeys(userId: string): Promise<{ fmpKey: string; finnhubKey?: string }> {
  const fmpKey = await userSubscription.getDecryptedKey(userId, 'fmp');
  let finnhubKey: string | undefined;
  try {
    finnhubKey = await userSubscription.getDecryptedKey(userId, 'finnhub');
  } catch (err) {
    if (!(err instanceof userSubscription.MissingUserApiKeyError)) throw err;
  }
  return { fmpKey, finnhubKey };
}

// GET /analysis/contrarian-comeback/:symbol/gate - auto-checks (1/3/4) only,
// no user answers needed yet. Lets the page show gate results (and whether
// the Check-3 override is available) before rendering the checkbox form.
export async function contrarianComebackGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbol = getSymbolParam(req);
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }

  try {
    const userId = getUserId(req);
    const { fmpKey, finnhubKey } = await resolveKeys(userId);
    const { apiCallCounts, ...data } = await contrarianComebackData.fetchContrarianComebackData(symbol, fmpKey, finnhubKey);
    // Populates the short-lived Gate -> Submit cache (contrarianComebackCache.ts) - if the user
    // goes on to Submit within 30 minutes, that call reuses this fetch instead of repeating it.
    contrarianComebackCache.setCachedGateResult(userId, symbol, data);
    const result = await analysisService.computeContrarianComebackGate(data);
    // Gate runs the exact same full fetch as Submit below (fetchContrarianComebackData is
    // stateless and called independently by both) - previously only Submit was logged, so an
    // attempt that failed the gate (or that the user simply never carried through to Submit)
    // left its real FMP/Finnhub cost with zero record anywhere. Same feature bucket
    // ('contrarian_comeback') as Submit - this counts a second real cost against it, it doesn't
    // introduce a new one.
    usageTracking.logUsage(userId, 'contrarian_comeback', apiCallCounts)
      .catch((e) => console.error('usage log failed', e));
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
    if (err instanceof InvalidTickerError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /analysis/contrarian-comeback/:symbol - the 3 user-answered checks
// (breakdown type, catalyst, and the conditional Check-3 override) go in the
// body. Re-fetches the same FMP data independently of the gate call above -
// stateless, matching Contrarian Finder's per-batch assembleUniverse() philosophy.
export async function contrarianComebackSubmit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbol = getSymbolParam(req);
  if (!symbol) {
    res.status(400).json({ error: 'A ticker symbol is required.' });
    return;
  }

  const { breakdownTypes, catalystAnswer, check3Override, check3OverrideReason } = req.body ?? {};
  if (!Array.isArray(breakdownTypes) || breakdownTypes.length === 0) {
    res.status(400).json({ error: 'At least one breakdown type must be selected.' });
    return;
  }
  if (catalystAnswer !== 'yes' && catalystAnswer !== 'no') {
    res.status(400).json({ error: 'catalystAnswer must be "yes" or "no".' });
    return;
  }

  try {
    const userId = getUserId(req);
    // Reuses a same-user Gate call for this symbol if it's still within the 30-minute window
    // (contrarianComebackCache.ts) - skips resolveKeys() and the real fetch entirely on a hit,
    // since no external call is being made. A miss (expired, or Gate was never run for this
    // symbol) falls back to today's fresh-fetch behavior unchanged.
    const cached = contrarianComebackCache.getCachedGateResult(userId, symbol);
    let data: Omit<contrarianComebackData.ContrarianComebackData, 'apiCallCounts'>;
    let apiCallCounts: { fmp: number; finnhub: number };
    if (cached) {
      data = cached;
      apiCallCounts = { fmp: 0, finnhub: 0 };
    } else {
      const { fmpKey, finnhubKey } = await resolveKeys(userId);
      const fetched = await contrarianComebackData.fetchContrarianComebackData(symbol, fmpKey, finnhubKey);
      apiCallCounts = fetched.apiCallCounts ?? { fmp: 0, finnhub: 0 };
      const { apiCallCounts: _drop, ...rest } = fetched;
      data = rest;
    }
    const result = await analysisService.computeContrarianComebackSubmit({
      ...data,
      breakdownTypes,
      catalystAnswer,
      check3Override: Boolean(check3Override),
      check3OverrideReason: check3OverrideReason ?? null,
    });
    // A cache hit still logs a real usage event ({fmp:0, finnhub:0}) - a genuine analysis ran,
    // so event_count should still reflect that, but the honest zero cost keeps the Usage Audit
    // numbers accurate rather than looking identical to a real ~10-call run.
    usageTracking.logUsage(userId, 'contrarian_comeback', apiCallCounts)
      .catch((e) => console.error('usage log failed', e));
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
    if (err instanceof InvalidTickerError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}
