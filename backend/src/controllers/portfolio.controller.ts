import { Request, Response, NextFunction } from 'express';
import * as portfolioService from '../services/portfolio.service';
import { parseFile, isRobinhoodTxt } from '../services/parser.service';
import * as marketData from '../services/marketData.service';

// Every route this controller serves sits behind requireAuth (see app.ts), so
// req.user is always populated by the time a handler runs.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

// req.params.id types as string | string[] (Express allows array route
// params in some configurations); a bare :id segment is always a single
// string at runtime, this just satisfies the type checker.
function getIdParam(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const portfolios = await portfolioService.listPortfolios(getUserId(req));
    res.json({ portfolios });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name, broker } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A portfolio name is required.' });
    return;
  }

  try {
    const portfolio = await portfolioService.createPortfolio(getUserId(req), name.trim(), broker ?? null);
    res.status(201).json({ portfolio });
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const portfolio = await portfolioService.getPortfolio(getUserId(req), getIdParam(req));
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found.' });
      return;
    }
    res.json({ portfolio });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name, broker } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'Portfolio name cannot be blank.' });
    return;
  }

  try {
    const portfolio = await portfolioService.updatePortfolio(getUserId(req), getIdParam(req), {
      name: name !== undefined ? name.trim() : undefined,
      broker: broker !== undefined ? broker : undefined,
    });
    if (!portfolio) {
      res.status(404).json({ error: 'Portfolio not found.' });
      return;
    }
    res.json({ portfolio });
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deleted = await portfolioService.deletePortfolio(getUserId(req), getIdParam(req));
    if (!deleted) {
      res.status(404).json({ error: 'Portfolio not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function importHoldings(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { filename, content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'File content is required.' });
    return;
  }

  try {
    const parsed = parseFile(content);
    const sourceFormat = isRobinhoodTxt(content) ? 'robinhood_txt' : 'csv';
    const result = await portfolioService.importHoldings(
      getUserId(req),
      getIdParam(req),
      parsed,
      typeof filename === 'string' ? filename : '',
      sourceFormat,
    );
    res.json(result);
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof Error && /Missing required columns|CSV appears to be empty|Could not locate Robinhood|No valid/.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function refreshPrices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const holdings = await portfolioService.refreshPrices(getUserId(req), getIdParam(req));
    res.json({ holdings });
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof marketData.MissingApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
