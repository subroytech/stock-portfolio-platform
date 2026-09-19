jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/configProperty.service', () => ({ getConfigInt: jest.fn() }));

import { pool } from '../src/db/pool';
import { getConfigInt } from '../src/services/configProperty.service';
import { checkCandlestickRateLimit } from '../src/services/candlestickRateLimit.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetConfigInt = getConfigInt as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetConfigInt.mockReset();
});

describe('checkCandlestickRateLimit', () => {
  test('allowed when usage in the window is under the configured limit', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const result = await checkCandlestickRateLimit('u1');

    expect(result).toEqual({ allowed: true, limit: 10, windowMinutes: 10, usedInWindow: 3 });
  });

  test('blocked once usage in the window reaches the limit', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }] });

    const result = await checkCandlestickRateLimit('u1');

    expect(result.allowed).toBe(false);
    expect(result.usedInWindow).toBe(10);
  });

  test('resolves N and M via getConfigInt with the documented property keys and defaults', async () => {
    mockGetConfigInt.mockResolvedValueOnce(5).mockResolvedValueOnce(15);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await checkCandlestickRateLimit('u1');

    expect(mockGetConfigInt).toHaveBeenCalledWith('stock_analysis_candlestick_max_new_requests', 10);
    expect(mockGetConfigInt).toHaveBeenCalledWith('stock_analysis_candlestick_window_minutes', 10);
  });

  test('counts only this user\'s own stock_analysis_candlestick rows within the resolved window', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await checkCandlestickRateLimit('u1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("feature = 'stock_analysis_candlestick'");
    expect(sql).toContain('user_id = $1');
    expect(params).toEqual(['u1', 7]);
  });
});
