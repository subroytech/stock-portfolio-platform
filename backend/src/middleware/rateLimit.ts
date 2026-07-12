// Two stacked limiters per Architecture.md Phase 1 step 7. Per-user limiting
// falls back to per-IP until Phase 2's auth middleware populates req.user —
// the key function is written now so Phase 2 activates real per-user limits
// for free, with no change to this file.

import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import env from '../config/env';

const perIpLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMaxPerIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again shortly.' },
});

const perUserLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMaxPerUser,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  },
  message: { error: 'Too many requests from this account, please try again shortly.' },
});

export default [perIpLimiter, perUserLimiter];
