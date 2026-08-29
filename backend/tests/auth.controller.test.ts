jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/impersonation.service', () => ({
  ...jest.requireActual('../src/services/impersonation.service'),
  startImpersonation: jest.fn(),
  endImpersonation: jest.fn(),
}));
import request from 'supertest';
import { pool } from '../src/db/pool';
import { hashPassword, signToken } from '../src/services/auth.service';
import * as impersonationService from '../src/services/impersonation.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockStartImpersonation = impersonationService.startImpersonation as jest.Mock;
const mockEndImpersonation = impersonationService.endImpersonation as jest.Mock;

// signup() also assigns the new user the baseline 'user' role
// (roles.service.ts's setUserRole, transactional via pool.connect()) - a
// mock client so that transaction succeeds without needing real role rows.
function mockRoleAssignmentClient() {
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
    if (sql.includes('SELECT id FROM m_roles')) return Promise.resolve({ rows: [{ id: 'role-user' }] });
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string;
  status?: string;
}

// signup/login both start with a SELECT (existing-email check / credential
// lookup); signup follows with an INSERT if that SELECT came back empty.
// Keyed on SQL text rather than call order so each test only has to describe
// what's "in the database," not the exact query sequence.
function mockDb({ existingUser, insertedUser }: { existingUser?: DbUserRow; insertedUser?: { id: string; email: string } } = {}) {
  // Defaults status to 'active' so every pre-existing test (written before login()
  // started checking status) keeps describing an account that can actually log in,
  // unless a test deliberately overrides it to exercise the new status gate.
  const resolvedExistingUser = existingUser ? { status: 'active', ...existingUser } : undefined;
  mockQuery.mockImplementation((text: string) => {
    if (text.startsWith('SELECT')) {
      return Promise.resolve({ rows: resolvedExistingUser ? [resolvedExistingUser] : [] });
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
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(mockRoleAssignmentClient());
  });

  test('creates a user and sets the auth cookie', async () => {
    mockDb({ insertedUser: { id: '1', email: 'new@example.com' } });
    const res = await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'longenoughpassword' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user: { id: '1', email: 'new@example.com' } });
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('assigns the baseline "user" role to every new signup', async () => {
    mockDb({ insertedUser: { id: '1', email: 'new@example.com' } });
    const client = mockRoleAssignmentClient();
    mockConnect.mockResolvedValue(client);
    await request(app).post('/auth/signup').send({ email: 'new@example.com', password: 'longenoughpassword' });
    expect(client.query).toHaveBeenCalledWith('INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)', ['1', 'role-user']);
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

  test('rejects correct credentials for a deactivated account with 401', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash, status: 'deactivated' } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'correctpassword' });
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

describe('GET /auth/me', () => {
  beforeEach(() => mockQuery.mockReset());

  test('401 without a session cookie', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('200 with { id, email, roles, permissions } for a valid session', async () => {
    const authCookie = `auth_token=${signToken('1')}`;
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com' }] });
      // Checked before the generic 'users_roles' branch - getUserPermissions' query also
      // contains 'users_roles' (it joins through it), so the more specific substring must
      // win or every role-name row would get misread as a permission-key row.
      if (text.includes('m_role_permissions')) return Promise.resolve({ rows: [{ permission_key: 'contrarian_finder:scan' }] });
      if (text.includes('users_roles')) return Promise.resolve({ rows: [{ name: 'user' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['contrarian_finder:scan'], impersonating: false });
  });

  test('401 if the session references a user that no longer exists', async () => {
    const authCookie = `auth_token=${signToken('999')}`;
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(401);
  });

  test('impersonating: true when the token carries impersonatedBy', async () => {
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ id: '2', email: 'target@b.com' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.impersonating).toBe(true);
  });
});

// Shared query mock for impersonate/stop-impersonating - requirePermission's own check query
// also contains "m_role_permissions" (same substring-matching precedent as GET /auth/me's own
// test above), so a non-empty `permissions` list doubles as "the gate passes."
function mockSessionQueries(userRow: { id: string; email: string } | null, roles: string[] = [], permissions: string[] = []) {
  mockQuery.mockImplementation((text: string) => {
    if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: userRow ? [userRow] : [] });
    if (text.includes('m_role_permissions')) return Promise.resolve({ rows: permissions.map((p) => ({ permission_key: p })) });
    if (text.includes('users_roles')) return Promise.resolve({ rows: roles.map((r) => ({ name: r })) });
    return Promise.resolve({ rows: [] });
  });
}

describe('POST /auth/impersonate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockStartImpersonation.mockReset();
    mockEndImpersonation.mockReset();
  });

  test('403 without users:impersonate', async () => {
    mockSessionQueries(null, [], []); // no permissions granted
    const authCookie = `auth_token=${signToken('1')}`;
    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(403);
    expect(mockStartImpersonation).not.toHaveBeenCalled();
  });

  test('409 when already impersonating', async () => {
    mockSessionQueries(null, [], ['users:impersonate']);
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;
    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '3' });
    expect(res.status).toBe(409);
    expect(mockStartImpersonation).not.toHaveBeenCalled();
  });

  test('200 sets a new cookie for the target user', async () => {
    mockSessionQueries({ id: '2', email: 'target@b.com' }, ['user'], ['users:impersonate']);
    mockStartImpersonation.mockResolvedValue({ id: '2', email: 'target@b.com' });
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('2');
    expect(res.body.impersonating).toBe(true);
    expect(mockStartImpersonation).toHaveBeenCalledWith('1', '2');
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('404 when the target does not exist', async () => {
    const { TargetUserNotFoundError } = jest.requireActual('../src/services/impersonation.service');
    mockSessionQueries(null, [], ['users:impersonate']);
    mockStartImpersonation.mockRejectedValue(new TargetUserNotFoundError('gone'));
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '999' });
    expect(res.status).toBe(404);
  });

  test('403 when the target holds admin-console access', async () => {
    const { CannotImpersonateAdminError } = jest.requireActual('../src/services/impersonation.service');
    mockSessionQueries(null, [], ['users:impersonate']);
    mockStartImpersonation.mockRejectedValue(new CannotImpersonateAdminError('blocked'));
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/stop-impersonating', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockStartImpersonation.mockReset();
    mockEndImpersonation.mockReset();
  });

  test('400 when not currently impersonating', async () => {
    const authCookie = `auth_token=${signToken('1')}`;
    const res = await request(app).post('/auth/stop-impersonating').set('Cookie', authCookie);
    expect(res.status).toBe(400);
    expect(mockEndImpersonation).not.toHaveBeenCalled();
  });

  test('200 restores the original admin\'s own session', async () => {
    mockSessionQueries({ id: '1', email: 'admin@b.com' }, ['admin-master'], ['users:impersonate']);
    mockEndImpersonation.mockResolvedValue(undefined);
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;

    const res = await request(app).post('/auth/stop-impersonating').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
    expect(res.body.impersonating).toBe(false);
    expect(mockEndImpersonation).toHaveBeenCalledWith('1', '2');
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });
});
