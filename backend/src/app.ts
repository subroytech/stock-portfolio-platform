import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import quotesRoutes from './routes/quotes.routes';
import contrarianFinderRoutes from './routes/contrarianFinder.routes';
import authRoutes from './routes/auth.routes';
import portfolioRoutes from './routes/portfolio.routes';
import userSubscriptionRoutes from './routes/userSubscription.routes';
import errorHandler from './middleware/errorHandler';
import rateLimiters from './middleware/rateLimit';
import requireAuth from './middleware/requireAuth';
import env from './config/env';

const app = express();

app.use(helmet());
// credentials + an explicit origin (not '*', which credentialed requests
// reject) — needed for the httpOnly auth cookie to cross the future frontend's
// origin. frontendOrigin defaults to localhost:3000 until Phase 3 exists.
app.use(cors({ origin: env.frontendOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' })); // generous limit: portfolio CSV/TXT uploads (POST /portfolios/:id/import) go through this
app.use(cookieParser());

// All five call FMP, touch auth state, or mutate user/portfolio data —
// rate-limited so one user/IP can't exhaust the shared quota / hammer
// signup-login/writes.
app.use('/quotes', rateLimiters, quotesRoutes);
app.use('/contrarian-finder', rateLimiters, contrarianFinderRoutes);
app.use('/auth', rateLimiters, authRoutes);
// requireAuth runs before rateLimiters so the per-user limiter (which reads
// req.user.id) actually has it populated — the first route to activate real
// per-user limits since rateLimit.ts was written anticipating this.
app.use('/portfolios', requireAuth, rateLimiters, portfolioRoutes);
app.use('/subscriptions', requireAuth, rateLimiters, userSubscriptionRoutes);

app.use(errorHandler);

export default app;
