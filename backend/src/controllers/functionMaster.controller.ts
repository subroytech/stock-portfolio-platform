import { Request, Response, NextFunction } from 'express';
import * as functionMasterService from '../services/functionMaster.service';

function getIdParam(req: Request): string {
  const raw = req.params.id;
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

// GET /functions - feeds the permission picker (activeOnly=true, the default) as well as the
// "View/Manage Functions" screen itself (activeOnly=false via ?all=true).
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const activeOnly = req.query.all !== 'true';
    const functions = await functionMasterService.listFunctions({ activeOnly });
    res.json({ functions });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { permissionKey, name, description, status } = req.body || {};
  if (typeof permissionKey !== 'string' || !permissionKey.trim()) {
    res.status(400).json({ error: 'A permissionKey is required.' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  try {
    const fn = await functionMasterService.createFunction({
      permissionKey: permissionKey.trim(),
      name: name.trim(),
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      status: typeof status === 'string' && status.trim() ? status.trim() : 'active',
    });
    res.status(201).json({ function: fn });
  } catch (err) {
    if (err instanceof functionMasterService.InvalidStatusError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof functionMasterService.DuplicateFunctionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { status } = req.body || {};
  if (typeof status !== 'string' || !status.trim()) {
    res.status(400).json({ error: 'A status is required.' });
    return;
  }
  try {
    const fn = await functionMasterService.updateFunctionStatus(getIdParam(req), status.trim());
    if (!fn) {
      res.status(404).json({ error: 'Function not found.' });
      return;
    }
    res.json({ function: fn });
  } catch (err) {
    if (err instanceof functionMasterService.InvalidStatusError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}
