// app.ts transitively requires ../src/db/pool (via contrarianFinder routes),
// and pool.ts throws at import time if DATABASE_URL is unset — mock it so this
// suite doesn't depend on a real .env/DB connection being present (matters in
// CI, which has no DATABASE_URL configured). Default to no rows, so the real
// (unmocked) userSubscription.getDecryptedKey() naturally hits its
// MissingUserApiKeyError path for the "no key on file" tests below.
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }), end: jest.fn() } }));

import request from 'supertest';
import { pool } from '../src/db/pool';
import app from '../src/app';
import { signToken } from '../src/services/auth.service';

const mockQuery = pool.query as unknown as jest.Mock;

// /quotes and /contrarian-finder became auth-required on 2026-07-12 (see
// app.ts) — a real, validly-signed cookie so requests pass through the real
// requireAuth middleware.
const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('app routing (no DB, no real FMP key required)', () => {
  test('GET /quotes without a session cookie returns 401', async () => {
    const res = await request(app).get('/quotes?symbols=AAPL');
    expect(res.status).toBe(401);
  });

  test('POST /contrarian-finder/scan without a session cookie returns 401', async () => {
    const res = await request(app).post('/contrarian-finder/scan').send({});
    expect(res.status).toBe(401);
  });

  test('GET /quotes without symbols returns 400', async () => {
    const res = await request(app).get('/quotes').set('Cookie', authCookie);
    expect(res.status).toBe(400);
  });

  test('GET /quotes?symbols=AAPL returns 503 when the caller has no FMP key on file', async () => {
    const res = await request(app).get('/quotes?symbols=AAPL').set('Cookie', authCookie);
    expect(res.status).toBe(503);
  });

  test('POST /contrarian-finder/scan returns 503 when the caller has no FMP key on file', async () => {
    const res = await request(app).post('/contrarian-finder/scan').set('Cookie', authCookie).send({});
    expect(res.status).toBe(503);
  });

  test('unknown route returns 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
