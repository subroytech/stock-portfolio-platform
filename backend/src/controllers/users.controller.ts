import { Request, Response, NextFunction } from 'express';
import * as rolesService from '../services/roles.service';
import * as authService from '../services/auth.service';
import * as usersService from '../services/users.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function getIdParam(req: Request): string {
  const raw = req.params.id;
  return (Array.isArray(raw) ? raw[0] : raw || '').trim();
}

// GET /users - View/Edit User Role (Admin Console Phase 2), gated by
// requirePermission('users:manage_roles') (see users.routes.ts).
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await rolesService.listUsersWithRoles();
    res.json({ users });
  } catch (err) {
    next(err);
  }
}

// POST /users - Create User (Admin Console Phase 6), gated by requirePermission('users:create').
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password, status, role } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }
  const resolvedStatus = typeof status === 'string' && status.trim() ? status.trim() : 'active';
  if (!usersService.isValidUserStatus(resolvedStatus)) {
    res.status(400).json({ error: `Unknown status: ${resolvedStatus}` });
    return;
  }
  const resolvedRole = typeof role === 'string' && role.trim() ? role.trim() : 'user';

  try {
    const user = await usersService.createUserAccount({ email, password, status: resolvedStatus, role: resolvedRole });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof authService.EmailAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof rolesService.InvalidRoleError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PUT /users/:id/status - reuses users:manage_roles (same "administer this account"
// capability as role-changing; the user didn't ask for a 5th, more granular key here).
export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = getIdParam(req);
  const { status } = req.body || {};

  if (typeof status !== 'string' || !status.trim()) {
    res.status(400).json({ error: 'A status is required.' });
    return;
  }

  try {
    await usersService.updateUserStatus(id, status.trim());
    res.json({ id, status: status.trim() });
  } catch (err) {
    if (err instanceof usersService.InvalidStatusError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PUT /users/:id - Manage Users edit-then-save (Admin Console Phase 7). Every field is
// optional - a partial update, applying only whatever the admin actually changed. Reuses
// the same service functions as the granular /role and /status routes rather than
// duplicating their logic.
export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = getIdParam(req);
  const { email, password, status, role } = req.body || {};

  if (email !== undefined && (typeof email !== 'string' || !EMAIL_RE.test(email))) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }
  if (status !== undefined && (typeof status !== 'string' || !usersService.isValidUserStatus(status))) {
    res.status(400).json({ error: `Unknown status: ${status}` });
    return;
  }
  if (role !== undefined && (typeof role !== 'string' || !role.trim())) {
    res.status(400).json({ error: 'A role name is required.' });
    return;
  }

  try {
    if (typeof email === 'string') await usersService.updateUserEmail(id, email);
    if (typeof password === 'string') {
      const passwordHash = await authService.hashPassword(password);
      await usersService.updateUserPassword(id, passwordHash);
    }
    if (typeof status === 'string') await usersService.updateUserStatus(id, status);
    if (typeof role === 'string') await rolesService.setUserRole(id, role);

    const detail = await usersService.getUserDetail(id);
    const roles = await rolesService.getUserRoles(id);
    res.json({ id, email: detail?.email, status: detail?.status, roles });
  } catch (err) {
    if (err instanceof authService.EmailAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof usersService.InvalidStatusError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof rolesService.InvalidRoleError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PUT /users/:id/role - admin-promotion, gated by requirePermission('users:manage_roles')
// (re-keyed from 'roles:manage', which now gates POST /roles instead - see users.routes.ts).
export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const idParam = req.params.id;
  const id = (Array.isArray(idParam) ? idParam[0] : idParam || '').trim();
  const { role } = req.body || {};

  if (typeof role !== 'string' || !role.trim()) {
    res.status(400).json({ error: 'A role name is required.' });
    return;
  }

  try {
    await rolesService.setUserRole(id, role);
    const roles = await rolesService.getUserRoles(id);
    res.json({ id, roles });
  } catch (err) {
    if (err instanceof rolesService.InvalidRoleError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}
