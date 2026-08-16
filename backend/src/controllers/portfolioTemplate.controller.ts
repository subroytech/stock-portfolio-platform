import { Request, Response, NextFunction } from 'express';
import * as portfolioTemplateService from '../services/portfolioTemplate.service';

function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

function getIdParam(req: Request): string {
  const raw = req.params.id;
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

// GET /portfolio-templates?search= - the "Existing Template" list, filtered server-side to
// Approved templates created by admin/admin-master or the caller themselves.
export async function listApproved(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;
    const templates = await portfolioTemplateService.listApprovedTemplates(getUserId(req), search);
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

// GET /portfolio-templates/admin/all - the Admin Console approval screen's full list,
// regardless of status/creator.
export async function listAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await portfolioTemplateService.listAllTemplates();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

// GET /portfolio-templates/mine/pending - the personal Pending-Approval dropdown.
export async function listMyPending(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await portfolioTemplateService.listMyPending(getUserId(req));
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

// POST /portfolio-templates - Save Template. No enforcement here that a real Dashboard was
// already rendered from this mapping - that's the caller's (portfolio.controller.ts's
// saveFlexTemplate) responsibility, since it's the one with the portfolio's
// flex_template_status to check.
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
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
    const template = await portfolioTemplateService.createTemplate({
      templateName,
      columnMapping,
      samplePreview,
      createdBy: getUserId(req),
      headerRowIndex: typeof headerRowIndex === 'number' ? headerRowIndex : 1,
      dataStartColumnIndex: typeof dataStartColumnIndex === 'number' ? dataStartColumnIndex : 1,
      howToUseDescription: typeof howToUseDescription === 'string' ? howToUseDescription : undefined,
    });
    res.status(201).json({ template });
  } catch (err) {
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

// PUT /portfolio-templates/:id/status - the Admin Console approval function.
export async function setStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { status } = req.body || {};
  if (status !== 'Approved' && status !== 'Rejected') {
    res.status(400).json({ error: 'status must be "Approved" or "Rejected".' });
    return;
  }
  try {
    await portfolioTemplateService.setTemplateStatus(getIdParam(req), status, getUserId(req));
    res.json({ success: true });
  } catch (err) {
    if (err instanceof portfolioTemplateService.TemplateNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// GET /portfolio-templates/:id - full detail (mapping + sample_preview), used by the Admin
// Console approval screen.
export async function getDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const template = await portfolioTemplateService.getTemplateDetail(getIdParam(req));
    res.json({ template });
  } catch (err) {
    if (err instanceof portfolioTemplateService.TemplateNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}
