// Two stacked limiters per Architecture.md Phase 1 step 7. Per-user limiting
// falls back to per-IP until requireAuth.ts populates req.user (Phase 2,
// 2026-07-11) — the key function was written ahead of time so real per-user
// limits activated for free the moment auth landed, with the only change
// being req.user's cast (now covered by src/types/express.d.ts's global
// augmentation instead of an inline cast here).

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
  keyGenerator: (req: Request) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  message: { error: 'Too many requests from this account, please try again shortly.' },
});

export default [perIpLimiter, perUserLimiter];
