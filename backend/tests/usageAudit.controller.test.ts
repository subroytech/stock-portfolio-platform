jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/usageTracking.service', () => ({
  ...jest.requireActual('../src/services/usageTracking.service'),
  getUsageRankingLast3Days: jest.fn(),
  getUsageRankingForMonth: jest.fn(),
  getAvailableUsageMonths: jest.fn(),
}));
// Enough real requests against the real /usage-audit router (mounted with rateLimiters in
// app.ts) to potentially trip the actual per-IP/per-user limiter - same no-op mock already
// used by other controller test files for the same reason.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));

import request from 'supertest';
import { pool } from '../src/db/pool';
import * as usageTracking from '../src/services/usageTracking.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetUsageRankingLast3Days = usageTracking.getUsageRankingLast3Days as jest.Mock;
const mockGetUsageRankingForMonth = usageTracking.getUsageRankingForMonth as jest.Mock;
const mockGetAvailableUsageMonths = usageTracking.getAvailableUsageMonths as jest.Mock;

const authCookie = `auth_token=${signToken('u1')}`;
const RANKING = [{ userId: 'u1', email: 'a@b.com', totalScore: 10, byFeature: { momentum: 10 } }];

beforeEach(() => {
  mockQuery.mockReset();
  mockGetUsageRankingLast3Days.mockReset();
  mockGetUsageRankingForMonth.mockReset();
  mockGetAvailableUsageMonths.mockReset();
});

describe('GET /usage-audit/last-3-days', () => {
  test('403 without usage_audit:view', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/usage-audit/last-3-days').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the ranking when granted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    mockGetUsageRankingLast3Days.mockResolvedValue(RANKING);
    const res = await request(app).get('/usage-audit/last-3-days').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ranking: RANKING });
  });
});

describe('GET /usage-audit/monthly', () => {
  test('403 without usage_audit:view', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/usage-audit/monthly').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('defaults to the current month when omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    mockGetUsageRankingForMonth.mockResolvedValue(RANKING);
    const res = await request(app).get('/usage-audit/monthly').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    const expectedMonth = new Date().toISOString().slice(0, 7) + '-01';
    expect(res.body.month).toBe(expectedMonth);
    expect(mockGetUsageRankingForMonth).toHaveBeenCalledWith(expectedMonth);
  });

  test('uses an explicit month query param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    mockGetUsageRankingForMonth.mockResolvedValue(RANKING);
    const res = await request(app).get('/usage-audit/monthly?month=2026-07-01').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-07-01');
    expect(mockGetUsageRankingForMonth).toHaveBeenCalledWith('2026-07-01');
  });

  test('400 for a malformed month', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/usage-audit/monthly?month=not-a-month').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });
});

describe('GET /usage-audit/available-months', () => {
  test('403 without usage_audit:view', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/usage-audit/available-months').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the months list when granted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    mockGetAvailableUsageMonths.mockResolvedValue(['2026-09-01', '2026-08-01']);
    const res = await request(app).get('/usage-audit/available-months').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: ['2026-09-01', '2026-08-01'] });
  });
});
