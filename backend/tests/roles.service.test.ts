jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  getUserRoles, getUserPermissions, setUserRole, InvalidRoleError, listRoles, createRole, DuplicateRoleError,
  listRolePermissions, grantPermission, revokePermission, listUsersWithRoles,
  deleteRole, RoleInUseError,
} from '../src/services/roles.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('getUserRoles', () => {
  test('returns the role names for a user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }, { name: 'admin' }] });
    expect(await getUserRoles('1')).toEqual(['user', 'admin']);
  });

  test('returns an empty array for a roleless user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserRoles('1')).toEqual([]);
  });
});

describe('getUserPermissions', () => {
  test('returns the distinct permission keys granted across all of a user\'s roles', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ permission_key: 'contrarian_finder:scan' }, { permission_key: 'api_keys:manage_own' }],
    });
    expect(await getUserPermissions('1')).toEqual(['contrarian_finder:scan', 'api_keys:manage_own']);
  });

  test('returns an empty array for a roleless (or permission-less) user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserPermissions('1')).toEqual([]);
  });
});

describe('setUserRole', () => {
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

  test('replaces (not appends): deletes existing role rows before inserting the new one, in a transaction', async () => {
    const client = makeMockClient();
    mockConnect.mockResolvedValue(client);

    await setUserRole('1', 'admin');

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((sql: string) => sql.startsWith('DELETE FROM users_roles'))).toBe(true);
    expect(calls.some((sql: string) => sql.startsWith('INSERT INTO users_roles'))).toBe(true);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    // DELETE must run before INSERT, matching the "replace" contract.
    const deleteIndex = calls.findIndex((sql: string) => sql.startsWith('DELETE FROM users_roles'));
    const insertIndex = calls.findIndex((sql: string) => sql.startsWith('INSERT INTO users_roles'));
    expect(deleteIndex).toBeLessThan(insertIndex);
    expect(client.release).toHaveBeenCalled();
  });

  test('throws InvalidRoleError for an unknown role name and rolls back, never reaching DELETE/INSERT', async () => {
    const client = makeMockClient({ roleFound: false });
    mockConnect.mockResolvedValue(client);

    await expect(setUserRole('1', 'superadmin')).rejects.toBeInstanceOf(InvalidRoleError);

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(calls.some((sql: string) => sql.startsWith('DELETE FROM users_roles'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('listRoles', () => {
  // node-pg returns COUNT()/INT8 columns as strings, not numbers - mocking with strings here
  // (matching what the real driver actually sends) is what catches userCount being coerced
  // to a real number, not just passed through as-is.
  test('returns all roles with their user count, coerced to a real number', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', name: 'user', user_count: '3' }, { id: '2', name: 'admin', user_count: '0' }],
    });
    const result = await listRoles();
    expect(result).toEqual([
      { id: '1', name: 'user', userCount: 3 },
      { id: '2', name: 'admin', userCount: 0 },
    ]);
    expect(result[0].userCount).toBe(3); // strict equality - would fail if still a string
  });
});

describe('createRole', () => {
  test('inserts and returns the new role with userCount 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '3', name: 'analyst' }] });
    expect(await createRole('analyst')).toEqual({ id: '3', name: 'analyst', userCount: 0 });
  });

  test('throws DuplicateRoleError on a unique-violation', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(createRole('admin')).rejects.toBeInstanceOf(DuplicateRoleError);
  });
});

describe('deleteRole', () => {
  test('deletes when no user holds the role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no users_roles rows
    mockQuery.mockResolvedValueOnce({}); // DELETE FROM m_roles
    await deleteRole('2');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM m_roles'), ['2']);
  });

  test('throws RoleInUseError and does not delete when a user holds the role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // a users_roles row exists
    await expect(deleteRole('2')).rejects.toBeInstanceOf(RoleInUseError);
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM m_roles'), expect.anything());
  });
});

describe('listRolePermissions', () => {
  test('returns permission keys for a role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'roles:manage' }, { permission_key: 'functions:manage' }] });
    expect(await listRolePermissions('2')).toEqual(['roles:manage', 'functions:manage']);
  });
});

describe('grantPermission / revokePermission', () => {
  test('grantPermission inserts with ON CONFLICT DO NOTHING', async () => {
    mockQuery.mockResolvedValueOnce({});
    await grantPermission('2', 'functions:manage');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), ['2', 'functions:manage']);
  });

  test('revokePermission deletes the grant row', async () => {
    mockQuery.mockResolvedValueOnce({});
    await revokePermission('2', 'functions:manage');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM m_role_permissions'), ['2', 'functions:manage']);
  });
});

describe('listUsersWithRoles', () => {
  test('groups multi-row join results by user, one entry per user with a roles array', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', email: 'a@b.com', status: 'active', role_name: 'user', provider: null },
        { id: '2', email: 'admin@b.com', status: 'active', role_name: 'admin', provider: null },
      ],
    });
    expect(await listUsersWithRoles()).toEqual([
      { id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'active' },
      { id: '2', email: 'admin@b.com', roles: ['admin'], apiKeyProviders: [], status: 'active' },
    ]);
  });

  test('a roleless user (LEFT JOIN with null role_name) gets an empty roles array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@b.com', status: 'active', role_name: null, provider: null }] });
    expect(await listUsersWithRoles()).toEqual([{ id: '1', email: 'a@b.com', roles: [], apiKeyProviders: [], status: 'active' }]);
  });

  test('a user with subscription rows gets a deduped apiKeyProviders array, even across the role/provider cross-product', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', email: 'a@b.com', status: 'active', role_name: 'user', provider: 'fmp' },
        { id: '1', email: 'a@b.com', status: 'active', role_name: 'user', provider: 'finnhub' },
      ],
    });
    expect(await listUsersWithRoles()).toEqual([
      { id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: ['fmp', 'finnhub'], status: 'active' },
    ]);
  });

  test('surfaces a non-active status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@b.com', status: 'deactivated', role_name: 'user', provider: null }] });
    expect(await listUsersWithRoles()).toEqual([
      { id: '1', email: 'a@b.com', roles: ['user'], apiKeyProviders: [], status: 'deactivated' },
    ]);
  });
});
