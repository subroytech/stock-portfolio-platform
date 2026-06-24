// Two stacked limiters per Architecture.md Phase 1 step 7. Per-user limiting
// falls back to per-IP until Phase 2's auth middleware populates req.user —
// the key function is written now so Phase 2 activates real per-user limits
// for free, with no change to this file.

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

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
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  message: { error: 'Too many requests from this account, please try again shortly.' },
});

module.exports = [perIpLimiter, perUserLimiter];
