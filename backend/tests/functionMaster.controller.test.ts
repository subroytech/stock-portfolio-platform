jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import request from 'supertest';
import { pool } from '../src/db/pool';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const authCookie = `auth_token=${signToken('caller-1')}`;

const dbRow = { id: '1', permission_key: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
});

describe('GET /functions', () => {
  test('401 without a session cookie', async () => {
    const res = await request(app).get('/functions');
    expect(res.status).toBe(401);
  });

  test('403 when the caller lacks permissions:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/functions').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the function list, mapped to camelCase', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    const res = await request(app).get('/functions').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      functions: [{ id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' }],
    });
  });
});

describe('POST /functions', () => {
  test('403 when the caller lacks functions:manage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/functions').set('Cookie', authCookie).send({ permissionKey: 'x:y', name: 'X' });
    expect(res.status).toBe(403);
  });

  test('400 when permissionKey is missing', async () => {
    const res = await request(app).post('/functions').set('Cookie', authCookie).send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  test('400 when name is missing', async () => {
    const res = await request(app).post('/functions').set('Cookie', authCookie).send({ permissionKey: 'x:y' });
    expect(res.status).toBe(400);
  });

  test('201 with the created function, defaulting status to active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    const res = await request(app).post('/functions').set('Cookie', authCookie).send({ permissionKey: 'roles:manage', name: 'Manage Roles' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      function: { id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' },
    });
  });

  test('409 for a duplicate permission key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    const res = await request(app).post('/functions').set('Cookie', authCookie).send({ permissionKey: 'roles:manage', name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /functions/:id', () => {
  test('400 when status is missing', async () => {
    const res = await request(app).put('/functions/1').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
  });

  test('400 for an unrecognized status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    const res = await request(app).put('/functions/1').set('Cookie', authCookie).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('404 when no function matches the id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/functions/999').set('Cookie', authCookie).send({ status: 'inactive' });
    expect(res.status).toBe(404);
  });

  test('200 with the updated function', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // requirePermission
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, status: 'inactive' }] });
    const res = await request(app).put('/functions/1').set('Cookie', authCookie).send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.function.status).toBe('inactive');
  });
});
