import { Request, Response, NextFunction } from 'express';
import * as portfolioService from '../services/portfolio.service';
import type { PortfolioStatus, PortfolioType, ManagedPortfolioFilters } from '../services/portfolio.service';

// Admin - Portfolio Admin - Manage Portfolio. Every route here is gated by
// requirePermission('portfolio_admin:manage') in portfolioAdmin.routes.ts.

const VALID_STATUSES: PortfolioStatus[] = ['Active', 'In-Active', 'Soft-Delete'];
const VALID_TYPES: PortfolioType[] = ['Legacy', 'Flex'];

function getIdParam(req: Request): string {
  return String(req.params.id);
}

// Single-select filters. An empty or "All" value means no filter.
function parseFilters(query: Request['query']): { filters?: ManagedPortfolioFilters; error?: string } {
  const filters: ManagedPortfolioFilters = {};
  const userId = typeof query.userId === 'string' && query.userId.trim() !== '' ? query.userId.trim() : undefined;
  if (userId) filters.userId = userId;

  const type = typeof query.portfolioType === 'string' ? query.portfolioType : '';
  if (type && type !== 'All') {
    if (!VALID_TYPES.includes(type as PortfolioType)) return { error: 'portfolioType must be Legacy or Flex.' };
    filters.portfolioType = type as PortfolioType;
  }

  const status = typeof query.status === 'string' ? query.status : '';
  if (status && status !== 'All') {
    if (!VALID_STATUSES.includes(status as PortfolioStatus)) return { error: 'status must be Active, In-Active or Soft-Delete.' };
    filters.status = status as PortfolioStatus;
  }
  return { filters };
}

export async function listPortfolios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filters, error } = parseFilters(req.query);
    if (error || !filters) {
      res.status(400).json({ error: error ?? 'Invalid filters.' });
      return;
    }
    const portfolios = await portfolioService.listManagedPortfolios(filters);
    res.json({ portfolios });
  } catch (err) {
    next(err);
  }
}

export async function restorePortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const restored = await portfolioService.restorePortfolio(getIdParam(req));
    if (!restored) {
      res.status(404).json({ error: 'Portfolio not found.' });
      return;
    }
    res.json({ portfolio: restored });
  } catch (err) {
    if (err instanceof portfolioService.PortfolioStatusError || err instanceof portfolioService.PortfolioNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function permanentlyDeletePortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deleted = await portfolioService.permanentlyDeleteSoftDeletedPortfolio(getIdParam(req));
    if (!deleted) {
      res.status(404).json({ error: 'Portfolio not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof portfolioService.PortfolioStatusError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}
