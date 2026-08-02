jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  createUserAccount, updateUserStatus, isValidUserStatus, InvalidStatusError,
  updateUserEmail, updateUserPassword, getUserDetail,
} from '../src/services/users.service';
import { EmailAlreadyExistsError } from '../src/services/auth.service';
import { InvalidRoleError } from '../src/services/roles.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

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
});

describe('isValidUserStatus', () => {
  test.each(['active', 'deactivated', 'cancelled', 'pending'])('accepts "%s"', (status) => {
    expect(isValidUserStatus(status)).toBe(true);
  });

  test('rejects an unknown status', () => {
    expect(isValidUserStatus('bogus')).toBe(false);
  });
});

describe('createUserAccount', () => {
  test('creates the user, assigns the role, and returns id/email/status/roles', async () => {
    mockConnect.mockResolvedValue(makeMockClient());
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', email: 'new@b.com' }] }); // createUser INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles

    const result = await createUserAccount({ email: 'new@b.com', password: 'longenoughpassword', status: 'active', role: 'user' });
    expect(result).toEqual({ id: '5', email: 'new@b.com', status: 'active', roles: ['user'] });
  });

  test('propagates EmailAlreadyExistsError from a duplicate email', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(createUserAccount({ email: 'dup@b.com', password: 'longenoughpassword', status: 'active', role: 'user' }))
      .rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  test('propagates InvalidRoleError from an unknown role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '5', email: 'new@b.com' }] }); // createUser INSERT
    mockConnect.mockResolvedValue(makeMockClient({ roleFound: false }));
    await expect(createUserAccount({ email: 'new@b.com', password: 'longenoughpassword', status: 'active', role: 'superadmin' }))
      .rejects.toBeInstanceOf(InvalidRoleError);
  });
});

describe('updateUserStatus', () => {
  test('updates the status column', async () => {
    mockQuery.mockResolvedValueOnce({});
    await updateUserStatus('2', 'deactivated');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET status'), ['2', 'deactivated']);
  });

  test('throws InvalidStatusError for an unknown status, without querying', async () => {
    await expect(updateUserStatus('2', 'bogus')).rejects.toBeInstanceOf(InvalidStatusError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('updateUserEmail', () => {
  test('updates the email column', async () => {
    mockQuery.mockResolvedValueOnce({});
    await updateUserEmail('2', 'new@b.com');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET email'), ['2', 'new@b.com']);
  });

  test('a unique-violation is translated to EmailAlreadyExistsError', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(updateUserEmail('2', 'dup@b.com')).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });
});

describe('updateUserPassword', () => {
  test('updates the password_hash column', async () => {
    mockQuery.mockResolvedValueOnce({});
    await updateUserPassword('2', 'somehash');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET password_hash'), ['2', 'somehash']);
  });
});

describe('getUserDetail', () => {
  test('returns the current row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '2', email: 'a@b.com', status: 'active' }] });
    expect(await getUserDetail('2')).toEqual({ id: '2', email: 'a@b.com', status: 'active' });
  });

  test('returns null when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserDetail('999')).toBeNull();
  });
});
