jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import request from 'supertest';
import { pool } from '../src/db/pool';
import { encrypt } from '../src/utils/encryption';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;

// A real, validly-signed cookie so requests pass through the real
// requireAuth middleware — this suite is testing userSubscription
// .controller.ts, not auth.
const authCookie = `auth_token=${signToken('user-1')}`;

beforeEach(() => mockQuery.mockReset());

describe('auth gating', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/subscriptions');
    expect(res.status).toBe(401);
  });
});

describe('GET /subscriptions', () => {
  test('200 with masked keys - response never contains the plaintext', async () => {
    const encrypted = encrypt('sk-super-secret-key');
    mockQuery.mockResolvedValue({
      rows: [{
        provider: 'fmp', api_key_encrypted: encrypted, plan_tier: 'Basic', status: 'active',
        renewal_date: null, created_at: 't1', updated_at: 't1',
      }],
    });
    const res = await request(app).get('/subscriptions').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.subscriptions[0].maskedKey).toBe('••••••••-key');
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secret-key');
  });
});

describe('PUT /subscriptions/:provider', () => {
  test('200 on success - response never contains the plaintext key', async () => {
    mockQuery.mockImplementation((_sql: string, params: unknown[]) => Promise.resolve({
      rows: [{
        provider: 'fmp', api_key_encrypted: params[2], plan_tier: params[3], status: params[4],
        renewal_date: params[5], created_at: 't1', updated_at: 't1',
      }],
    }));
    const res = await request(app).put('/subscriptions/fmp').set('Cookie', authCookie).send({ apiKey: 'sk-real-key-abcd', planTier: 'Basic' });
    expect(res.status).toBe(200);
    expect(res.body.subscription).toMatchObject({ provider: 'fmp', planTier: 'Basic', maskedKey: '••••••••abcd' });
    expect(JSON.stringify(res.body)).not.toContain('sk-real-key-abcd');
  });

  test('400 for an unrecognized provider', async () => {
    const res = await request(app).put('/subscriptions/notaprovider').set('Cookie', authCookie).send({ apiKey: 'x' });
    expect(res.status).toBe(400);
  });

  test('400 when apiKey is missing', async () => {
    const res = await request(app).put('/subscriptions/fmp').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /subscriptions/:provider', () => {
  test('200 on success', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1' }] });
    const res = await request(app).delete('/subscriptions/fmp').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('404 when nothing matched', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).delete('/subscriptions/fmp').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});
