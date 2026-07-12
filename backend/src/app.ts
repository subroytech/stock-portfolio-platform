import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import quotesRoutes from './routes/quotes.routes';
import contrarianFinderRoutes from './routes/contrarianFinder.routes';
import errorHandler from './middleware/errorHandler';
import rateLimiters from './middleware/rateLimit';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' })); // generous limit: portfolio CSV/TXT uploads go through this once /portfolios exists

// Both routes call FMP — rate-limited so one user/IP can't exhaust the shared quota.
app.use('/quotes', rateLimiters, quotesRoutes);
app.use('/contrarian-finder', rateLimiters, contrarianFinderRoutes);

app.use(errorHandler);

export default app;
