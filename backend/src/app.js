const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const quotesRoutes = require('./routes/quotes.routes');
const contrarianFinderRoutes = require('./routes/contrarianFinder.routes');
const errorHandler = require('./middleware/errorHandler');
const rateLimiters = require('./middleware/rateLimit');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' })); // generous limit: portfolio CSV/TXT uploads go through this once /portfolios exists

// Both routes call FMP — rate-limited so one user/IP can't exhaust the shared quota.
app.use('/quotes', rateLimiters, quotesRoutes);
app.use('/contrarian-finder', rateLimiters, contrarianFinderRoutes);

app.use(errorHandler);

module.exports = app;
