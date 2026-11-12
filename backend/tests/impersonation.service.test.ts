jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/auth.service', () => ({
  ...jest.requireActual('../src/services/auth.service'),
  findUserById: jest.fn(),
}));
jest.mock('../src/services/roles.service', () => ({
  ...jest.requireActual('../src/services/roles.service'),
  getUserPermissions: jest.fn(),
}));

import { pool } from '../src/db/pool';
import * as authService from '../src/services/auth.service';
import * as rolesService from '../src/services/roles.service';
import {
  startImpersonation, endImpersonation, TargetUserNotFoundError, CannotImpersonateAdminError,
} from '../src/services/impersonation.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockFindUserById = authService.findUserById as jest.Mock;
const mockGetUserPermissions = rolesService.getUserPermissions as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockFindUserById.mockReset();
  mockGetUserPermissions.mockReset();
});

describe('startImpersonation', () => {
  test('succeeds for an ordinary user, logging the audit row', async () => {
    mockFindUserById.mockResolvedValue({ id: 'user-2', email: 'plain@b.com' });
    mockGetUserPermissions.mockResolvedValue(['portfolio_upload:legacy']);
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await startImpersonation('admin-1', 'user-2');

    expect(result).toEqual({ id: 'user-2', email: 'plain@b.com' });
    expect(mockQuery).toHaveBeenCalledWith(
      'INSERT INTO user_evt_impersonation_log (admin_user_id, target_user_id) VALUES ($1, $2)',
      ['admin-1', 'user-2'],
    );
  });

  test('throws TargetUserNotFoundError when the target does not exist', async () => {
    mockFindUserById.mockResolvedValue(null);
    await expect(startImpersonation('admin-1', 'nope')).rejects.toBeInstanceOf(TargetUserNotFoundError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('blocks impersonating a target with any admin-console permission', async () => {
    mockFindUserById.mockResolvedValue({ id: 'user-2', email: 'other-admin@b.com' });
    mockGetUserPermissions.mockResolvedValue(['users:manage_roles']);

    await expect(startImpersonation('admin-1', 'user-2')).rejects.toBeInstanceOf(CannotImpersonateAdminError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('endImpersonation', () => {
  test('stamps ended_at on the matching open log row', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await endImpersonation('admin-1', 'user-2');
    expect(mockQuery).toHaveBeenCalledWith(
      `UPDATE user_evt_impersonation_log SET ended_at = now()
     WHERE admin_user_id = $1 AND target_user_id = $2 AND ended_at IS NULL`,
      ['admin-1', 'user-2'],
    );
  });
});
