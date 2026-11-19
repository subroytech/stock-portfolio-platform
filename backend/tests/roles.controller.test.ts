jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import request from 'supertest';
import { pool } from '../src/db/pool';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const authCookie = `auth_token=${signToken('caller-1')}`;

beforeEach(() => {
  mockQuery.mockReset();
  // requirePermission check on the route - default the caller to an admin so
  // tests below exercise the controller itself, unless a test overrides it.
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
});

describe('GET /roles', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/roles');
    expect(res.status).toBe(401);
  });

  test('403 when the caller lacks roles:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/roles').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the role list including userCount as a real number (node-pg returns COUNT() as a string)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', name: 'user', user_count: '3' }, { id: '2', name: 'admin', user_count: '0' }] });
    const res = await request(app).get('/roles').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [{ id: '1', name: 'user', userCount: 3 }, { id: '2', name: 'admin', userCount: 0 }] });
  });
});

describe('POST /roles', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).post('/roles').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('201 with the created role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '3', name: 'analyst' }] });
    const res = await request(app).post('/roles').set('Cookie', authCookie).send({ name: 'analyst' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ role: { id: '3', name: 'analyst', userCount: 0 } });
  });

  test('409 for a duplicate role name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    const res = await request(app).post('/roles').set('Cookie', authCookie).send({ name: 'admin' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /roles/:id', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).delete('/roles/2');
    expect(res.status).toBe(401);
  });

  test('403 when the caller lacks roles:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/roles/2').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 when no user holds the role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no users_roles rows
    mockQuery.mockResolvedValueOnce({}); // DELETE FROM m_roles
    const res = await request(app).delete('/roles/2').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('409 when a user still holds the role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // a users_roles row exists
    const res = await request(app).delete('/roles/2').set('Cookie', authCookie);
    expect(res.status).toBe(409);
  });
});

describe('GET /roles/:id/permissions', () => {
  test('403 when the caller lacks permissions:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/roles/2/permissions').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the permission list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'roles:manage' }] });
    const res = await request(app).get('/roles/2/permissions').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ permissions: ['roles:manage'] });
  });
});

describe('POST /roles/:id/permissions', () => {
  test('400 when permissionKey is missing', async () => {
    const res = await request(app).post('/roles/2/permissions').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('200 with the updated permission list after granting', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // grant insert
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'functions:manage' }] }); // re-list
    const res = await request(app).post('/roles/2/permissions').set('Cookie', authCookie).send({ permissionKey: 'functions:manage' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ permissions: ['functions:manage'] });
  });

  test('400 when the FK rejects an unknown permission key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockRejectedValueOnce({ code: '23503' });
    const res = await request(app).post('/roles/2/permissions').set('Cookie', authCookie).send({ permissionKey: 'not:real' });
    expect(res.status).toBe(400);
  });

  test('400 when granting contrarian_finder:scan_history to a role that does not already have contrarian_finder:scan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [] }); // grantPermission's own parent-check
    const res = await request(app).post('/roles/2/permissions').set('Cookie', authCookie).send({ permissionKey: 'contrarian_finder:scan_history' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('contrarian_finder:scan');
  });

  test('400 when granting config_properties:manage to a role that is not admin-master', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'admin' }] }); // grantPermission's role-name lookup
    const res = await request(app).post('/roles/2/permissions').set('Cookie', authCookie).send({ permissionKey: 'config_properties:manage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('admin-master');
  });
});

describe('DELETE /roles/:id/permissions/:key', () => {
  test('200 with the updated permission list after revoking', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({}); // delete
    mockQuery.mockResolvedValueOnce({ rows: [] }); // re-list
    const res = await request(app).delete('/roles/2/permissions/functions:manage').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ permissions: [] });
  });

  test('409 when revoking contrarian_finder:scan while the role still has the dependent contrarian_finder:scan_history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'contrarian_finder:scan_history' }] }); // revokePermission's own dependent-check
    const res = await request(app).delete('/roles/2/permissions/contrarian_finder:scan').set('Cookie', authCookie);
    expect(res.status).toBe(409);
  });
});
