import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import quotesRoutes from './routes/quotes.routes';
import contrarianFinderRoutes from './routes/contrarianFinder.routes';
import authRoutes from './routes/auth.routes';
import portfolioRoutes from './routes/portfolio.routes';
import userSubscriptionRoutes from './routes/userSubscription.routes';
import momentumRoutes from './routes/momentum.routes';
import stockPreviewRoutes from './routes/stockPreview.routes';
import errorHandler from './middleware/errorHandler';
import rateLimiters from './middleware/rateLimit';
import requireAuth from './middleware/requireAuth';
import env from './config/env';

const app = express();

app.use(helmet());
// credentials + an explicit origin (not '*', which credentialed requests
// reject) — needed for the httpOnly auth cookie to cross the frontend's
// origin (frontendOrigin defaults to localhost:3000 for local Vite dev).
app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' })); // generous limit: portfolio CSV/TXT uploads (POST /portfolios/:id/import) go through this
app.use(cookieParser());

// All of these call FMP, touch auth state, or mutate user/portfolio data —
// rate-limited so one user/IP can't exhaust the shared quota / hammer
// signup-login/writes.
//
// requireAuth runs before rateLimiters so the per-user limiter (which reads
// req.user.id) actually has it populated — rateLimit.ts was written
// anticipating this back on 2026-07-08.
//
// /quotes and /contrarian-finder became auth-required on 2026-07-12, when
// they switched from the global env.fmpApiKey to each caller's own
// users_subscriptions key (they need to know who's calling to resolve it) —
// an intentional breaking change to what were previously public routes.
// /momentum and /stock-preview (2026-07-13) are new, auth-required from day
// one, same per-user-key resolution pattern.
app.use('/quotes', requireAuth, rateLimiters, quotesRoutes);
app.use('/contrarian-finder', requireAuth, rateLimiters, contrarianFinderRoutes);
app.use('/auth', rateLimiters, authRoutes);
app.use('/portfolios', requireAuth, rateLimiters, portfolioRoutes);
app.use('/subscriptions', requireAuth, rateLimiters, userSubscriptionRoutes);
app.use('/momentum', requireAuth, rateLimiters, momentumRoutes);
app.use('/stock-preview', requireAuth, rateLimiters, stockPreviewRoutes);

app.use(errorHandler);

export default app;
