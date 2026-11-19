jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import { Request, Response } from 'express';
import { pool } from '../src/db/pool';
import requirePermission from '../src/middleware/requirePermission';

const mockQuery = pool.query as unknown as jest.Mock;

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockQuery.mockReset();
});

test('401s when req.user is missing (requireAuth did not run first)', async () => {
  const req = {} as Request;
  const res = makeRes();
  const next = jest.fn();

  await requirePermission('contrarian_finder:scan')(req, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
  expect(next).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
});

test('403s when the user has no role granting the permission', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = { user: { id: '1' } } as Request;
  const res = makeRes();
  const next = jest.fn();

  await requirePermission('contrarian_finder:scan')(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: 'You do not have permission to perform this action.' });
  expect(next).not.toHaveBeenCalled();
});

test('calls next() when the user has a role granting the permission', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  const req = { user: { id: '1' } } as Request;
  const res = makeRes();
  const next = jest.fn();

  await requirePermission('contrarian_finder:scan')(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('users_roles'), ['1', 'contrarian_finder:scan']);
});
