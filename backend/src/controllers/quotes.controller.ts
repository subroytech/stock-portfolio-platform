import { Request, Response, NextFunction } from 'express';
import * as marketData from '../services/marketData.service';

export async function getQuotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  const symbolsParam = req.query.symbols;
  if (!symbolsParam || typeof symbolsParam !== 'string') {
    res.status(400).json({ error: 'Query param "symbols" is required, e.g. ?symbols=AAPL,MSFT' });
    return;
  }
  const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    res.status(400).json({ error: 'No valid symbols provided.' });
    return;
  }

  try {
    const quotes = await marketData.getQuotes(symbols);
    res.json({ quotes });
  } catch (err) {
    if (err instanceof marketData.MissingApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}
