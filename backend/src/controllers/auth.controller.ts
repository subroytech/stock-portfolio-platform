import { Request, Response, NextFunction, CookieOptions } from 'express';
import * as authService from '../services/auth.service';
import * as rolesService from '../services/roles.service';
import * as impersonationService from '../services/impersonation.service';
import env from '../config/env';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function cookieOptions(maxAge: number = env.jwtExpiresInMs): CookieOptions {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge,
  };
}

// Shared by impersonate/stopImpersonating - the full resolved session shape the frontend
// expects (api/auth.ts's User), for a userId already confirmed to exist by the caller.
async function resolveSession(userId: string, impersonating: boolean) {
  const user = (await authService.findUserById(userId))!;
  const roles = await rolesService.getUserRoles(userId);
  const permissions = await rolesService.getUserPermissions(userId);
  return { ...user, roles, permissions, impersonating };
}

export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }

  try {
    const existing = await authService.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await authService.createUser(email, passwordHash);
    // Every new signup starts with the baseline 'user' role - without this,
    // a new account would be roleless (migration 015 only backfilled users
    // that existed at migration time), failing any future requirePermission
    // check gated on having *any* role, not just the admin-only ones.
    await rolesService.setUserRole(user.id, 'user');
    const token = authService.signToken(user.id);

    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof authService.EmailAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  try {
    const user = await authService.login(email, password);
    const token = authService.signToken(user.id);

    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    res.json({ user });
  } catch (err) {
    if (err instanceof authService.InvalidCredentialsError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(authService.AUTH_COOKIE_NAME, cookieOptions());
  res.json({ success: true });
}

// Fixes a real pre-existing gap: there was no way for the frontend to learn
// the current user's identity/roles after a page reload (see
// frontend/src/api/auth.ts's old /portfolios-probe + module-cache workaround).
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.findUserById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }
    const roles = await rolesService.getUserRoles(user.id);
    const permissions = await rolesService.getUserPermissions(user.id);
    res.json({ id: user.id, email: user.email, roles, permissions, impersonating: !!req.user!.impersonatedBy });
  } catch (err) {
    next(err);
  }
}

// POST /auth/impersonate - "Login-as" (users:impersonate, admin-master only in practice - see
// roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS). Issues a new, shorter-lived token for the
// target user, carrying the admin's own id as impersonatedBy so the session can always find its
// way back - no second cookie/session-store needed.
export async function impersonate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !userId.trim()) {
    res.status(400).json({ error: 'A userId is required.' });
    return;
  }
  // No nested impersonation - always return to your own account first. Checked here (not just
  // relying on startImpersonation) since it's about the CALLER's own current session state, not
  // the target.
  if (req.user!.impersonatedBy) {
    res.status(409).json({ error: 'Already impersonating a user - return to your own account first.' });
    return;
  }

  try {
    await impersonationService.startImpersonation(req.user!.id, userId.trim());
    const token = authService.signToken(userId.trim(), { impersonatedBy: req.user!.id, expiresIn: env.impersonationExpiresIn });
    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions(env.impersonationExpiresInMs));
    res.json(await resolveSession(userId.trim(), true));
  } catch (err) {
    if (err instanceof impersonationService.TargetUserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof impersonationService.CannotImpersonateAdminError) {
      res.status(403).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /auth/stop-impersonating - restores the original admin's own (normal-length) session.
// requireAuth only, no extra permission needed - if you're holding a valid impersonation token
// at all, you're always allowed to end it.
export async function stopImpersonating(req: Request, res: Response, next: NextFunction): Promise<void> {
  const adminId = req.user!.impersonatedBy;
  if (!adminId) {
    res.status(400).json({ error: 'Not currently impersonating a user.' });
    return;
  }

  try {
    await impersonationService.endImpersonation(adminId, req.user!.id);
    const token = authService.signToken(adminId);
    res.cookie(authService.AUTH_COOKIE_NAME, token, cookieOptions());
    res.json(await resolveSession(adminId, false));
  } catch (err) {
    next(err);
  }
}
