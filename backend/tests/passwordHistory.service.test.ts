jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import { hashPassword } from '../src/services/auth.service';
import { recordPassword, isPasswordReused } from '../src/services/passwordHistory.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => mockQuery.mockReset());

describe('recordPassword', () => {
  test('inserts the new hash, then prunes to the 5 most recent rows for that user', async () => {
    mockQuery.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await recordPassword('7', 'hash-abc');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO user_evt_password_history');
    expect(mockQuery.mock.calls[0][1]).toEqual(['7', 'hash-abc']);
    expect(mockQuery.mock.calls[1][0]).toContain('DELETE FROM user_evt_password_history');
    expect(mockQuery.mock.calls[1][1]).toEqual(['7', 5]);
  });
});

describe('isPasswordReused', () => {
  test('true when the candidate matches one of the last 5 stored hashes', async () => {
    const oldHash = await hashPassword('OldPassword123!Xyz');
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'unrelated-hash' }, { password_hash: oldHash }] });
    expect(await isPasswordReused('7', 'OldPassword123!Xyz')).toBe(true);
  });

  test('false when the candidate matches none of the stored hashes', async () => {
    const oldHash = await hashPassword('OldPassword123!Xyz');
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: oldHash }] });
    expect(await isPasswordReused('7', 'BrandNewPassword456!Abc')).toBe(false);
  });

  test('false when the account has no password history yet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isPasswordReused('7', 'AnyPassword123!Xyz')).toBe(false);
  });
});
