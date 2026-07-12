import 'dotenv/config';

function num(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

export interface Env {
  port: number;
  databaseUrl: string;

  fmpApiKey: string;
  fmpBaseUrl: string;
  fmp3BaseUrl: string;
  fmp4BaseUrl: string;

  finnhubApiKey: string;
  finnhubBaseUrl: string;

  rateLimitWindowMs: number;
  rateLimitMaxPerUser: number;
  rateLimitMaxPerIp: number;

  jwtSecret: string;
}

// DATABASE_URL is intentionally allowed to be blank here — it's a CockroachDB
// Cloud connection string set per-environment in .env (never committed).
// pool.ts is what actually requires it, not boot.
const env: Readonly<Env> = {
  port: num(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL || '',

  fmpApiKey: process.env.FMP_API_KEY || '',
  fmpBaseUrl: process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable',
  fmp3BaseUrl: process.env.FMP3_BASE_URL || 'https://financialmodelingprep.com/v3',
  fmp4BaseUrl: process.env.FMP4_BASE_URL || 'https://financialmodelingprep.com/v4',

  finnhubApiKey: process.env.FINNHUB_API_KEY || '',
  finnhubBaseUrl: process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1',

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMaxPerUser: num(process.env.RATE_LIMIT_MAX_PER_USER, 30),
  rateLimitMaxPerIp: num(process.env.RATE_LIMIT_MAX_PER_IP, 60),

  jwtSecret: process.env.JWT_SECRET || '', // unused until Phase 2
};

export default env;
