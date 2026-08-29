import { Request, Response, NextFunction } from 'express';
import * as rolesService from '../services/roles.service';

function getIdParam(req: Request, name = 'id'): string {
  const raw = req.params[name];
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

// GET /roles - View/Create Role (Admin Console Phase 3), gated by requirePermission('roles:manage').
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = await rolesService.listRoles();
    res.json({ roles });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A role name is required.' });
    return;
  }
  try {
    const role = await rolesService.createRole(name.trim());
    res.status(201).json({ role });
  } catch (err) {
    if (err instanceof rolesService.DuplicateRoleError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// GET/POST/DELETE /roles/:id/permissions - View/Edit Permission (Admin Console Phase 3),
// gated by requirePermission('permissions:manage'). The FK on m_role_permissions.permission_key
// (migration 016) is the real guarantee that grant/revoke can't reference a fake key.
export async function listPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const permissions = await rolesService.listRolePermissions(getIdParam(req));
    res.json({ permissions });
  } catch (err) {
    next(err);
  }
}

export async function grantPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { permissionKey } = req.body || {};
  if (typeof permissionKey !== 'string' || !permissionKey.trim()) {
    res.status(400).json({ error: 'A permissionKey is required.' });
    return;
  }
  try {
    await rolesService.grantPermission(getIdParam(req), permissionKey.trim());
    const permissions = await rolesService.listRolePermissions(getIdParam(req));
    res.json({ permissions });
  } catch (err) {
    // FK violation - the picker only offers active/QA-Test functions, but this guards against
    // a stale client sending a permissionKey that isn't (or is no longer) in m_function_master.
    if ((err as { code?: string })?.code === '23503') {
      res.status(400).json({ error: `Unknown permission key: ${permissionKey}` });
      return;
    }
    if (err instanceof rolesService.MissingParentPermissionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof rolesService.RoleNotAllowedForPermissionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function revokePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await rolesService.revokePermission(getIdParam(req), getIdParam(req, 'key'));
    const permissions = await rolesService.listRolePermissions(getIdParam(req));
    res.json({ permissions });
  } catch (err) {
    if (err instanceof rolesService.ParentPermissionInUseError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// DELETE /roles/:id - Manage Role (Admin Console Phase 7), gated by requirePermission('roles:manage').
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await rolesService.deleteRole(getIdParam(req));
    res.json({ success: true });
  } catch (err) {
    if (err instanceof rolesService.RoleInUseError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}
