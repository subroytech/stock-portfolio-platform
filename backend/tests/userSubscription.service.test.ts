jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../src/db/pool';
import { encrypt, decrypt } from '../src/utils/encryption';
import { listSubscriptions, upsertSubscription, deleteSubscription, getDecryptedKey, MissingUserApiKeyError } from '../src/services/userSubscription.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => mockQuery.mockReset());

describe('upsertSubscription', () => {
  test('encrypts the key before it ever reaches the DB - never stores plaintext', async () => {
    mockQuery.mockImplementation((_sql: string, params: unknown[]) => {
      const storedCiphertext = params[2] as string;
      return Promise.resolve({
        rows: [{
          provider: 'fmp', api_key_encrypted: storedCiphertext, plan_tier: 'Basic', status: 'active',
          renewal_date: null, created_at: 't1', updated_at: 't1',
        }],
      });
    });

    const result = await upsertSubscription('user-1', 'fmp', { apiKey: 'sk-real-fmp-key', planTier: 'Basic' });

    const [, params] = mockQuery.mock.calls[0];
    const storedCiphertext = params[2] as string;
    expect(storedCiphertext).not.toBe('sk-real-fmp-key');
    expect(decrypt(storedCiphertext)).toBe('sk-real-fmp-key'); // round-trips correctly

    expect(result.provider).toBe('fmp');
    expect(result.planTier).toBe('Basic');
    expect(result.maskedKey).toBe('••••••••-key'); // last 4 chars of 'sk-real-fmp-key'
  });

  test('defaults status to active and planTier/renewalDate to null when not provided', async () => {
    mockQuery.mockImplementation((_sql: string, params: unknown[]) => Promise.resolve({
      rows: [{
        provider: 'finnhub', api_key_encrypted: params[2], plan_tier: params[3], status: params[4],
        renewal_date: params[5], created_at: 't1', updated_at: 't1',
      }],
    }));
    const result = await upsertSubscription('user-1', 'finnhub', { apiKey: 'key123' });
    expect(result.status).toBe('active');
    expect(result.planTier).toBeNull();
    expect(result.renewalDate).toBeNull();
  });
});

describe('listSubscriptions', () => {
  test('masks the key and never returns the plaintext anywhere in the result', async () => {
    const encrypted = encrypt('sk-another-key-9999');
    mockQuery.mockResolvedValue({
      rows: [{
        provider: 'finnhub', api_key_encrypted: encrypted, plan_tier: null, status: 'active',
        renewal_date: null, created_at: 't1', updated_at: 't1',
      }],
    });
    const result = await listSubscriptions('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].maskedKey).toBe('••••••••9999');
    expect(JSON.stringify(result)).not.toContain('sk-another-key-9999');
  });

  test('returns an empty array when the user has no subscriptions', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await listSubscriptions('user-1')).toEqual([]);
  });
});

describe('deleteSubscription', () => {
  test('returns true when a row was deleted', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1' }] });
    expect(await deleteSubscription('user-1', 'fmp')).toBe(true);
  });

  test('returns false when nothing matched', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await deleteSubscription('user-1', 'fmp')).toBe(false);
  });
});

// Admin-Master Fallback API Key (User Manual.md) - a caller with no key of their own falls
// back to the single admin-master account's key, but only for fallback-eligible roles.
describe('getDecryptedKey', () => {
  test("returns the caller's own key without ever looking up roles", async () => {
    const encrypted = encrypt('sk-own-key-1111');
    mockQuery.mockResolvedValueOnce({ rows: [{ api_key_encrypted: encrypted }] });
    expect(await getDecryptedKey('user-1', 'fmp')).toBe('sk-own-key-1111');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  // getUserRoles and the fallback-eligible-roles config read run concurrently (Promise.all),
  // so both mocks must be queued regardless of which branch the test cares about - order
  // matches Promise.all's synchronous invocation order (getUserRoles first, config read
  // second), same as the real pool.query call sequence.
  test('falls back to admin-master\'s key for a fallback-eligible role with no key of its own', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no own key
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user,admin,user-contra-wokey' }] }); // fallback-roles config
    const adminMasterEncrypted = encrypt('sk-admin-master-key');
    mockQuery.mockResolvedValueOnce({ rows: [{ api_key_encrypted: adminMasterEncrypted }] }); // getAdminMasterKey
    expect(await getDecryptedKey('user-2', 'fmp')).toBe('sk-admin-master-key');
  });

  test('falls back for user-contra-wokey specifically', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user-contra-wokey' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user,admin,user-contra-wokey' }] });
    const adminMasterEncrypted = encrypt('sk-admin-master-key');
    mockQuery.mockResolvedValueOnce({ rows: [{ api_key_encrypted: adminMasterEncrypted }] });
    expect(await getDecryptedKey('user-3', 'fmp')).toBe('sk-admin-master-key');
  });

  test('falls back for user-premium specifically - the role that surfaced this config-driven list live', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user-premium' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user,admin,user-contra-wokey,user-premium' }] });
    const adminMasterEncrypted = encrypt('sk-admin-master-key');
    mockQuery.mockResolvedValueOnce({ rows: [{ api_key_encrypted: adminMasterEncrypted }] });
    expect(await getDecryptedKey('user-premium-1', 'fmp')).toBe('sk-admin-master-key');
  });

  test('the eligible-roles list is genuinely DB-driven - a role omitted from the configured value is not fallback-eligible even though it once was', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no own key
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }] }); // getUserRoles - normally eligible
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'admin,user-contra-wokey' }] }); // config omits 'user' this time
    await expect(getDecryptedKey('user-6', 'fmp')).rejects.toThrow(/add one via PUT \/subscriptions/i);
  });

  test('throws a "contact an admin" error when fallback-eligible but admin-master has no key either', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no own key
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'admin' }] }); // getUserRoles
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user,admin,user-contra-wokey' }] }); // fallback-roles config
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getAdminMasterKey - nothing on file
    let caught: unknown;
    try {
      await getDecryptedKey('user-4', 'fmp');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingUserApiKeyError);
    expect((caught as Error).message).toMatch(/contact an admin/i);
  });

  test('user-contra-withkey is NOT fallback-eligible - still a hard "add your own key" error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no own key
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user-contra-withkey' }] }); // getUserRoles
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user,admin,user-contra-wokey,user-premium' }] }); // fallback-roles config
    await expect(getDecryptedKey('user-5', 'fmp')).rejects.toThrow(/add one via PUT \/subscriptions/i);
  });

  test('falls back to the code-level default list when the config row is missing (no config write ever happened)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no own key
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user-premium' }] }); // getUserRoles
    mockQuery.mockResolvedValueOnce({ rows: [] }); // fallback-roles config - missing row
    const adminMasterEncrypted = encrypt('sk-admin-master-key');
    mockQuery.mockResolvedValueOnce({ rows: [{ api_key_encrypted: adminMasterEncrypted }] });
    // user-premium is in the code-level default fallback list too, so this still succeeds.
    expect(await getDecryptedKey('user-7', 'fmp')).toBe('sk-admin-master-key');
  });
});
