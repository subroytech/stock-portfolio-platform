jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../src/db/pool';
import { encrypt, decrypt } from '../src/utils/encryption';
import { listSubscriptions, upsertSubscription, deleteSubscription } from '../src/services/userSubscription.service';

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
