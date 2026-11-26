jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/fmpRateLimit.service', () => ({
  ...jest.requireActual('../src/services/fmpRateLimit.service'),
  checkFmpRateLimit: jest.fn(),
}));

import request from 'supertest';
import * as fmpRateLimit from '../src/services/fmpRateLimit.service';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockCheckFmpRateLimit = fmpRateLimit.checkFmpRateLimit as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockCheckFmpRateLimit.mockReset();
});

describe('GET /rate-limit/status', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/rate-limit/status');
    expect(res.status).toBe(401);
  });

  test('200 with remaining computed from limit minus usedInWindow for a non-exempt user', async () => {
    mockCheckFmpRateLimit.mockResolvedValue({ allowed: true, exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 17 });
    const res = await request(app).get('/rate-limit/status').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 17, remaining: 33 });
  });

  test('remaining never goes negative even if usedInWindow somehow exceeds limit', async () => {
    mockCheckFmpRateLimit.mockResolvedValue({ allowed: false, exempt: false, limit: 50, windowMinutes: 5, usedInWindow: 62 });
    const res = await request(app).get('/rate-limit/status').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(0);
  });

  test('remaining is null for an exempt (admin/admin-master) user', async () => {
    mockCheckFmpRateLimit.mockResolvedValue({ allowed: true, exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0 });
    const res = await request(app).get('/rate-limit/status').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0, remaining: null });
  });
});
