jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/configProperty.service', () => ({ getConfigInt: jest.fn() }));
jest.mock('../src/services/roles.service', () => ({ getUserRoles: jest.fn() }));

import { pool } from '../src/db/pool';
import { getConfigInt } from '../src/services/configProperty.service';
import { getUserRoles } from '../src/services/roles.service';
import { checkFmpRateLimit } from '../src/services/fmpRateLimit.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetConfigInt = getConfigInt as jest.Mock;
const mockGetUserRoles = getUserRoles as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetConfigInt.mockReset();
  mockGetUserRoles.mockReset();
  mockGetUserRoles.mockResolvedValue(['user']); // non-exempt by default
});

describe('checkFmpRateLimit', () => {
  test('admin is exempt - allowed with no config/usage query at all', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['admin']);

    const result = await checkFmpRateLimit('u1');

    expect(result).toEqual({ allowed: true, exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0 });
    expect(mockGetConfigInt).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('admin-master is exempt too', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['user-contra-withKey', 'admin-master']);

    const result = await checkFmpRateLimit('u1');

    expect(result.allowed).toBe(true);
    expect(result.exempt).toBe(true);
  });

  test('a plain user is not exempt', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['user-premium']);
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkFmpRateLimit('u1');

    expect(result.exempt).toBe(false);
    expect(mockGetConfigInt).toHaveBeenCalled();
  });

  test('allowed when real usage in the window is under the configured limit', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { api_call_details: { fmp_quote: 1 } },
        { api_call_details: { fmp_historical: 1 } },
        { api_call_details: { fmp_quote: 1 } },
      ],
    });

    const result = await checkFmpRateLimit('u1');

    expect(result).toEqual({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
  });

  test('blocked once real usage in the window reaches the limit', async () => {
    mockGetConfigInt.mockResolvedValueOnce(2).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ api_call_details: { fmp_quote: 1 } }, { api_call_details: { fmp_quote: 1 } }] });

    const result = await checkFmpRateLimit('u1');

    expect(result.allowed).toBe(false);
    expect(result.usedInWindow).toBe(2);
  });

  test('a row with every api_call_details value at 0 (served entirely from cache) does not count', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { api_call_details: { fmp_quote: 0, fmp_historical: 0 } }, // cache hit - free
        { api_call_details: { fmp_quote: 1 } }, // real call
        { api_call_details: null }, // no detail at all - treated as no real call
      ],
    });

    const result = await checkFmpRateLimit('u1');

    expect(result.usedInWindow).toBe(1);
  });

  test('sums real calls within a row, not just counts the row once - a real bug found live 2026-09-19 (Long-Term Analysis logs ~16 real calls in one row)', async () => {
    mockGetConfigInt.mockResolvedValueOnce(50).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({
      rows: [
        { api_call_details: { fmp: 15, finnhub: 1 } }, // one Long-Term Analysis call - 16 real calls, not 1
        { api_call_details: { fmp_quote: 1 } }, // one simple Stock Preview/Momentum-style call - 1
      ],
    });

    const result = await checkFmpRateLimit('u1');

    expect(result.usedInWindow).toBe(17); // 16 + 1, not 2
  });

  test('resolves N and M via getConfigInt with the same property keys/defaults the display-name renames still point at', async () => {
    mockGetConfigInt.mockResolvedValueOnce(5).mockResolvedValueOnce(15);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await checkFmpRateLimit('u1');

    expect(mockGetConfigInt).toHaveBeenCalledWith('stock_analysis_candlestick_max_new_requests', 10);
    expect(mockGetConfigInt).toHaveBeenCalledWith('stock_analysis_candlestick_window_minutes', 10);
  });

  test('counts across all 5 rate-limited features combined, not just candlestick', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await checkFmpRateLimit('u1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('feature = ANY($2)');
    expect(sql).toContain('user_id = $1');
    expect(params[0]).toBe('u1');
    expect(params[1]).toEqual(['stock_analysis_candlestick', 'stock_preview', 'momentum', 'long_term_analysis', 'contrarian_comeback']);
    expect(params[2]).toBe(7);
  });
});
