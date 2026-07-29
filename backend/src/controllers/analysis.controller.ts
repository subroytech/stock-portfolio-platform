import { Request, Response, NextFunction } from 'express';
import * as analysisService from '../services/analysisService';
import * as longTermAnalysisData from '../services/longTermAnalysisData.service';
import * as contrarianComebackData from '../services/contrarianComebackData.service';
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
    const { fmpKey, finnhubKey } = await resolveKeys(getUserId(req));
    const data = await contrarianComebackData.fetchContrarianComebackData(symbol, fmpKey, finnhubKey);
    const result = await analysisService.computeContrarianComebackGate(data);
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
    const { fmpKey, finnhubKey } = await resolveKeys(getUserId(req));
    const data = await contrarianComebackData.fetchContrarianComebackData(symbol, fmpKey, finnhubKey);
    const result = await analysisService.computeContrarianComebackSubmit({
      ...data,
      breakdownTypes,
      catalystAnswer,
      check3Override: Boolean(check3Override),
      check3OverrideReason: check3OverrideReason ?? null,
    });
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
