import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiFetch, ApiError } from './client';
import { queryClient, SESSION_EXPIRED_STORAGE_KEY } from '../lib/queryClient';

function mockFetchOnce(status: number, body: unknown = { error: 'nope' }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  }));
}

// Exercises the real apiFetch (not a mock of it) - the global 401 handling lives inside this
// function, so it has to actually run for these tests to mean anything.
describe('apiFetch - global 401 handling', () => {
  beforeEach(() => {
    queryClient.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('a 401 with a real session cached clears the session and flags sessionStorage', async () => {
    queryClient.setQueryData(['session'], { id: '1', email: 'a@b.com', roles: ['user'], permissions: [] });
    mockFetchOnce(401);

    await expect(apiFetch('/contrarian-finder/last-scan')).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(['session'])).toBeNull();
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBe('1');
  });

  test('a 401 with no session cached (e.g. a failed login) does not set the expired flag', async () => {
    // Nothing cached at ['session'] - mirrors a fresh visit or LoginPage's own failed attempt.
    mockFetchOnce(401);

    await expect(apiFetch('/auth/login')).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(['session'])).toBeNull();
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeNull();
  });

  test('a 403 (valid session, wrong permission) leaves the session and flag untouched', async () => {
    const user = { id: '1', email: 'a@b.com', roles: ['user'], permissions: [] };
    queryClient.setQueryData(['session'], user);
    mockFetchOnce(403);

    await expect(apiFetch('/roles')).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(['session'])).toEqual(user);
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeNull();
  });

  // Regression test for a real reported bug: change-password/security-questions used to return
  // 401 for "your current password is wrong," which is a valid-session business-logic failure,
  // not an auth failure - it was tripping this same global handler and force-logging the user
  // out mid-form. Fixed by having those endpoints return 400 instead (see auth.controller.ts).
  test('a 400 (e.g. wrong current password on Change Password) leaves the session and flag untouched', async () => {
    const user = { id: '1', email: 'a@b.com', roles: ['user'], permissions: [] };
    queryClient.setQueryData(['session'], user);
    mockFetchOnce(400, { error: 'Current password is incorrect.' });

    await expect(apiFetch('/auth/change-password', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(['session'])).toEqual(user);
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeNull();
  });

  test('a successful response never touches the session or the flag', async () => {
    const user = { id: '1', email: 'a@b.com', roles: ['user'], permissions: [] };
    queryClient.setQueryData(['session'], user);
    mockFetchOnce(200, { ok: true });

    await expect(apiFetch('/portfolios')).resolves.toEqual({ ok: true });

    expect(queryClient.getQueryData(['session'])).toEqual(user);
    expect(sessionStorage.getItem(SESSION_EXPIRED_STORAGE_KEY)).toBeNull();
  });
});
