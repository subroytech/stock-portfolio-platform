import { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE_NAME, verifyToken } from '../services/auth.service';

// Populates req.user from the httpOnly session cookie, 401s if missing/
// invalid. This is what activates rateLimit.ts's per-user limiting "for
// free," exactly as that file's own comment anticipated.
export default function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const { userId } = verifyToken(token);
    req.user = { id: userId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
}
