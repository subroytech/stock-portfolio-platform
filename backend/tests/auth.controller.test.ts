jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
import request from 'supertest';
import { pool } from '../src/db/pool';
import { hashPassword } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string;
}

// signup/login both start with a SELECT (existing-email check / credential
// lookup); signup follows with an INSERT if that SELECT came back empty.
// Keyed on SQL text rather than call order so each test only has to describe
// what's "in the database," not the exact query sequence.
function mockDb({ existingUser, insertedUser }: { existingUser?: DbUserRow; insertedUser?: { id: string; email: string } } = {}) {
  mockQuery.mockImplementation((text: string) => {
    if (text.startsWith('SELECT')) {
      return Promise.resolve({ rows: existingUser ? [existingUser] : [] });
    }
    if (text.startsWith('INSERT')) {
      return Promise.resolve({ rows: insertedUser ? [insertedUser] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function getCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((c: string) => c.startsWith('auth_token=')) || '';
}

describe('POST /auth/signup', () => {
  beforeEach(() => mockQuery.mockReset());

  test('creates a user and sets the auth cookie', async () => {
    mockDb({ insertedUser: { id: '1', email: 'new@example.com' } });
    const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'longenoughpassword' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user: { id: '1', email: 'new@example.com' } });
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('rejects an already-registered email with 409', async () => {
    mockDb({ existingUser: { id: '1', email: 'dup@example.com', password_hash: 'x' } });
    const res = await request(app).post('/auth/signup').send({ email: 'dup@example.com', password: 'longenoughpassword' });
    expect(res.status).toBe(409);
  });

  test('rejects an invalid email with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ email: 'not-an-email', password: 'longenoughpassword' });
    expect(res.status).toBe(400);
  });

  test('rejects a too-short password with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => mockQuery.mockReset());

  test('logs in with correct credentials and sets the auth cookie', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'correctpassword' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: '1', email: 'a@b.com' } });
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('rejects a wrong password with 401', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects an unknown email with 401 and the same message as a wrong password', async () => {
    mockDb({});
    const unknownRes = await request(app).post('/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(unknownRes.status).toBe(401);

    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const wrongRes = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'wrongpassword' });

    expect(unknownRes.body.error).toBe(wrongRes.body.error);
  });
});

describe('POST /auth/logout', () => {
  test('clears the auth cookie', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(getCookie(res)).toMatch(/^auth_token=;/);
  });
});
