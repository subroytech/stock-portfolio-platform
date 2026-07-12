import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  status?: number;
}

export default function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
}
