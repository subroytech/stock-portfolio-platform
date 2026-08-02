jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import request from 'supertest';
import { pool } from '../src/db/pool';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

const authCookie = `auth_token=${signToken('caller-1')}`;

function makeMockClient(opts: { roleFound?: boolean } = {}) {
  const { roleFound = true } = opts;
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
    if (sql.includes('SELECT id FROM m_roles')) return Promise.resolve({ rows: roleFound ? [{ id: 'role-2' }] : [] });
    if (sql.startsWith('DELETE FROM users_roles')) return Promise.resolve({});
    if (sql.startsWith('INSERT INTO users_roles')) return Promise.resolve({});
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  // requirePermission('users:manage_roles') check on the route - default the
  // caller to an admin so tests below exercise the controller itself.
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
});

describe('GET /users', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });

  test("403 when the caller doesn't have users:manage_roles (not an admin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/users').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the user list (email + roles + apiKeyProviders + status) for an admin caller', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', email: 'a@b.com', status: 'active', role_name: 'user', provider: 'fmp' },
        { id: '2', email: 'admin@b.com', status: 'deactivated', role_name: 'admin', provider: null },
      ],
    });

    const res = await request(app).get('/users').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users: [
        { id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: ['fmp'], status: 'active' },
        { id: '2', email: 'admin@b.com', roles: ['admin'], apiKeyProviders: [], status: 'deactivated' },
      ],
    });
  });
});

describe('POST /users', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).post('/users').send({ email: 'new@b.com', password: 'longenoughpassword' });
    expect(res.status).toBe(401);
  });

  test("403 when the caller doesn't have users:create (not an admin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/users').set('Cookie', authCookie).send({ email: 'new@b.com', password: 'longenoughpassword' });
    expect(res.status).toBe(403);
  });

  test('400 for an invalid email', async () => {
    const res = await request(app).post('/users').set('Cookie', authCookie).send({ email: 'not-an-email', password: 'longenoughpassword' });
    expect(res.status).toBe(400);
  });

  test('400 for a too-short password', async () => {
    const res = await request(app).post('/users').set('Cookie', authCookie).send({ email: 'new@b.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  test('400 for an unrecognized status', async () => {
    const res = await request(app).post('/users').set('Cookie', authCookie)
      .send({ email: 'new@b.com', password: 'longenoughpassword', status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('201 with the created user, defaulting status to active and role to user', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', email: 'new@b.com' }] }); // createUser INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles

    const res = await request(app).post('/users').set('Cookie', authCookie).send({ email: 'new@b.com', password: 'longenoughpassword' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: '5', email: 'new@b.com', status: 'active', roles: ['user'] });
  });

  test('201 honors an explicit status', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', email: 'new@b.com' }] }); // createUser INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles

    const res = await request(app).post('/users').set('Cookie', authCookie)
      .send({ email: 'new@b.com', password: 'longenoughpassword', status: 'deactivated' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('deactivated');
  });

  test('409 for a duplicate email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockRejectedValueOnce({ code: '23505' }); // createUser INSERT unique violation
    const res = await request(app).post('/users').set('Cookie', authCookie).send({ email: 'dup@b.com', password: 'longenoughpassword' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /users/:id/status', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).put('/users/2/status').send({ status: 'deactivated' });
    expect(res.status).toBe(401);
  });

  test("403 when the caller doesn't have users:manage_roles (not an admin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/users/2/status').set('Cookie', authCookie).send({ status: 'deactivated' });
    expect(res.status).toBe(403);
  });

  test('400 when status is missing from the body', async () => {
    const res = await request(app).put('/users/2/status').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('400 for an unrecognized status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    const res = await request(app).put('/users/2/status').set('Cookie', authCookie).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('200 with the updated status for an admin caller', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // UPDATE users SET status
    const res = await request(app).put('/users/2/status').set('Cookie', authCookie).send({ status: 'deactivated' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '2', status: 'deactivated' });
  });
});

describe('PUT /users/:id', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).put('/users/2').send({ email: 'new@b.com' });
    expect(res.status).toBe(401);
  });

  test("403 when the caller doesn't have users:manage_roles (not an admin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ email: 'new@b.com' });
    expect(res.status).toBe(403);
  });

  test('400 for an invalid email', async () => {
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('400 for a too-short password', async () => {
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  test('400 for an unrecognized status', async () => {
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('400 when role is an empty string', async () => {
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ role: '   ' });
    expect(res.status).toBe(400);
  });

  test('200 updating only the email, leaving password/status/role untouched', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // updateUserEmail
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '2', email: 'new@b.com', status: 'active' }] }); // getUserDetail
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles

    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ email: 'new@b.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '2', email: 'new@b.com', status: 'active', roles: ['user'] });
    expect(mockConnect).not.toHaveBeenCalled(); // no role field given, setUserRole never invoked
  });

  test('409 when the new email is already taken', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockRejectedValueOnce({ code: '23505' }); // updateUserEmail unique violation
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ email: 'dup@b.com' });
    expect(res.status).toBe(409);
  });

  test('200 updating only the password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // updateUserPassword
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '2', email: 'a@b.com', status: 'active' }] }); // getUserDetail
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles

    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ password: 'brandnewpassword' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '2', email: 'a@b.com', status: 'active', roles: ['user'] });
  });

  test('200 updating email, password, status, and role together', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // updateUserEmail
    mockQuery.mockResolvedValueOnce({}); // updateUserPassword
    mockQuery.mockResolvedValueOnce({}); // updateUserStatus
    // setUserRole uses mockConnect, not mockQuery
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '2', email: 'new@b.com', status: 'deactivated' }] }); // getUserDetail
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'admin' }] }); // getUserRoles

    const res = await request(app).put('/users/2').set('Cookie', authCookie)
      .send({ email: 'new@b.com', password: 'brandnewpassword', status: 'deactivated', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '2', email: 'new@b.com', status: 'deactivated', roles: ['admin'] });
  });

  test('400 for an unknown role name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockConnect.mockResolvedValue(makeMockClient({ roleFound: false }));
    const res = await request(app).put('/users/2').set('Cookie', authCookie).send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /users/:id/role', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).put('/users/2/role').send({ role: 'admin' });
    expect(res.status).toBe(401);
  });

  test("403 when the caller doesn't have users:manage_roles (not an admin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/users/2/role').set('Cookie', authCookie).send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  test('400 when role is missing from the body', async () => {
    const res = await request(app).put('/users/2/role').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('400 for an unknown role name', async () => {
    mockConnect.mockResolvedValue(makeMockClient({ roleFound: false }));
    const res = await request(app).put('/users/2/role').set('Cookie', authCookie).send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  test('200 with the updated roles for a real admin caller and a valid target role', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    // getUserRoles() call after setUserRole() succeeds - read back the new assignment.
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'admin' }] }); // getUserRoles

    const res = await request(app).put('/users/2/role').set('Cookie', authCookie).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '2', roles: ['admin'] });
  });
});
