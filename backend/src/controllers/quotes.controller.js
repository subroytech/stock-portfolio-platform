const marketData = require('../services/marketData.service');

async function getQuotes(req, res, next) {
  const symbolsParam = req.query.symbols;
  if (!symbolsParam) {
    return res.status(400).json({ error: 'Query param "symbols" is required, e.g. ?symbols=AAPL,MSFT' });
  }
  const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    return res.status(400).json({ error: 'No valid symbols provided.' });
  }

  try {
    const quotes = await marketData.getQuotes(symbols);
    res.json({ quotes });
  } catch (err) {
    if (err instanceof marketData.MissingApiKeyError) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = { getQuotes };
