import { Request, Response, NextFunction, CookieOptions } from 'express';
import * as authService from '../services/auth.service';
import * as rolesService from '../services/roles.service';
import env from '../config/env';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: env.jwtExpiresInMs,
  };
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
    res.json({ id: user.id, email: user.email, roles, permissions });
  } catch (err) {
    next(err);
  }
}
