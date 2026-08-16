import { Request, Response, NextFunction } from 'express';
import * as portfolioService from '../services/portfolio.service';
import { parseFile, isRobinhoodTxt } from '../services/parser.service';
import * as flexParser from '../services/flexParser.service';
import * as portfolioTemplateService from '../services/portfolioTemplate.service';
import * as userSubscription from '../services/userSubscription.service';
import * as usageTracking from '../services/usageTracking.service';

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
  const { filename, content, dryRun } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'File content is required.' });
    return;
  }

  try {
    const parsed = parseFile(content);
    const sourceFormat = isRobinhoodTxt(content) ? 'robinhood_txt' : 'csv';

    // Preview only — parseFile() is pure (no DB access at all), so this
    // returns before ever calling portfolioService.importHoldings, which is
    // where every tx_* write happens. Lets the caller inspect a parse
    // without replacing anything (see the import-preview plan, 2026-07-13).
    if (dryRun === true) {
      res.json({
        preview: true,
        sourceFormat,
        holdings: parsed.data,
        cashAmount: parsed.cashAmount,
        errors: parsed.errors,
      });
      return;
    }

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

// POST /portfolios/flex - Portfolio Upload - Flex creation (CLAUDE.md's "Portfolio Upload -
// Flex" section). Either uploadTemplateId (an existing template) or columnMapping (a brand
// new one) must be given.
const PARSE_ERROR_PATTERN = /CSV appears to be empty|No valid rows found|row .* is out of range|column .* is out of range/;

export async function createFlex(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name, broker, uploadTemplateId, columnMapping, headerRowIndex, dataStartColumnIndex, filename, content, dryRun } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'File content is required.' });
    return;
  }
  const hasTemplateId = typeof uploadTemplateId === 'string' && uploadTemplateId.trim();
  const hasMapping = columnMapping && typeof columnMapping === 'object' && !Array.isArray(columnMapping);
  if (!hasTemplateId && !hasMapping) {
    res.status(400).json({ error: 'Either uploadTemplateId or columnMapping is required.' });
    return;
  }

  // Preview only — the "Inspect Data" step of the mapping wizard. Mirrors importHoldings()'s
  // own dryRun branch: parseFlexCsv() is pure (no DB writes), so this returns before ever
  // reaching portfolioService.createPortfolioFlex, which is where the real tx_portfolios/
  // tx_holdings rows get written. Lets a mapping be proven-parseable before any portfolio
  // (and thus any name) needs to exist yet.
  if (dryRun === true) {
    try {
      let mapping: flexParser.ColumnMapping;
      let effectiveHeaderRowIndex: number;
      let effectiveDataStartColumnIndex: number;
      if (hasTemplateId) {
        const config = await portfolioTemplateService.getTemplateParseConfig(uploadTemplateId.trim());
        mapping = config.columnMapping;
        effectiveHeaderRowIndex = config.headerRowIndex;
        effectiveDataStartColumnIndex = config.dataStartColumnIndex;
      } else {
        mapping = columnMapping;
        effectiveHeaderRowIndex = typeof headerRowIndex === 'number' ? headerRowIndex : 1;
        effectiveDataStartColumnIndex = typeof dataStartColumnIndex === 'number' ? dataStartColumnIndex : 1;
      }
      const parsed = flexParser.parseFlexCsv(content, mapping, {
        headerRowIndex: effectiveHeaderRowIndex,
        dataStartColumnIndex: effectiveDataStartColumnIndex,
      });
      res.json({ preview: true, holdings: parsed.data, cashAmount: parsed.cashAmount, errors: parsed.errors });
    } catch (err) {
      if (err instanceof portfolioTemplateService.TemplateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof flexParser.FlexMappingMismatchError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof Error && PARSE_ERROR_PATTERN.test(err.message)) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
    return;
  }

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A portfolio name is required.' });
    return;
  }

  try {
    const result = await portfolioService.createPortfolioFlex(getUserId(req), {
      name: name.trim(),
      broker: broker ?? null,
      uploadTemplateId: hasTemplateId ? uploadTemplateId.trim() : undefined,
      columnMapping: hasMapping ? columnMapping : undefined,
      headerRowIndex: typeof headerRowIndex === 'number' ? headerRowIndex : undefined,
      dataStartColumnIndex: typeof dataStartColumnIndex === 'number' ? dataStartColumnIndex : undefined,
      filename: typeof filename === 'string' ? filename : '',
      content,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioTemplateService.TemplateNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof flexParser.FlexMappingMismatchError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && PARSE_ERROR_PATTERN.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /portfolios/:id/flex-template - the forced Save Template action, only valid while the
// portfolio is genuinely unresolved ('Flex-Err').
export async function saveFlexTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { templateName, columnMapping, samplePreview, headerRowIndex, dataStartColumnIndex, howToUseDescription } = req.body || {};
  if (typeof templateName !== 'string' || !templateName.trim()) {
    res.status(400).json({ error: 'A templateName is required.' });
    return;
  }
  if (!columnMapping || typeof columnMapping !== 'object' || Array.isArray(columnMapping)) {
    res.status(400).json({ error: 'A columnMapping object is required.' });
    return;
  }

  try {
    const result = await portfolioService.saveFlexTemplate(getUserId(req), getIdParam(req), {
      templateName,
      columnMapping,
      samplePreview,
      headerRowIndex: typeof headerRowIndex === 'number' ? headerRowIndex : 1,
      dataStartColumnIndex: typeof dataStartColumnIndex === 'number' ? dataStartColumnIndex : 1,
      howToUseDescription: typeof howToUseDescription === 'string' ? howToUseDescription : undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioService.FlexTemplateStateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioTemplateService.InvalidTemplateNameError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioTemplateService.DuplicateTemplateNameError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PUT /portfolios/:id/flex-template - change an already-resolved portfolio's bound template.
// Always re-imports against the new mapping/template first.
export async function changeFlexTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { uploadTemplateId, columnMapping, headerRowIndex, dataStartColumnIndex, filename, content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'File content is required.' });
    return;
  }
  const hasTemplateId = typeof uploadTemplateId === 'string' && uploadTemplateId.trim();
  const hasMapping = columnMapping && typeof columnMapping === 'object' && !Array.isArray(columnMapping);
  if (!hasTemplateId && !hasMapping) {
    res.status(400).json({ error: 'Either uploadTemplateId or columnMapping is required.' });
    return;
  }

  try {
    const result = await portfolioService.changeFlexTemplate(getUserId(req), getIdParam(req), {
      uploadTemplateId: hasTemplateId ? uploadTemplateId.trim() : undefined,
      columnMapping: hasMapping ? columnMapping : undefined,
      headerRowIndex: typeof headerRowIndex === 'number' ? headerRowIndex : undefined,
      dataStartColumnIndex: typeof dataStartColumnIndex === 'number' ? dataStartColumnIndex : undefined,
      filename: typeof filename === 'string' ? filename : '',
      content,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioService.FlexTemplateStateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof portfolioTemplateService.TemplateNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof flexParser.FlexMappingMismatchError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && PARSE_ERROR_PATTERN.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function refreshPrices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getUserId(req);
    const result = await portfolioService.refreshPrices(userId, getIdParam(req));
    usageTracking.logUsage(userId, 'portfolio_refresh').catch((e) => console.error('usage log failed', e));
    res.json(result);
  } catch (err) {
    if (err instanceof portfolioService.PortfolioNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
