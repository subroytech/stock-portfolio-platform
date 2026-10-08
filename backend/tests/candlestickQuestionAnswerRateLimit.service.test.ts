jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/configProperty.service', () => ({ getConfigInt: jest.fn() }));
jest.mock('../src/services/roles.service', () => ({ getUserRoles: jest.fn() }));

import { pool } from '../src/db/pool';
import { getConfigInt } from '../src/services/configProperty.service';
import { getUserRoles } from '../src/services/roles.service';
import { checkRateLimit, recordRateLimitedCall } from '../src/services/candlestickQuestionAnswerRateLimit.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetConfigInt = getConfigInt as jest.Mock;
const mockGetUserRoles = getUserRoles as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetConfigInt.mockReset();
  mockGetUserRoles.mockReset();
  mockGetUserRoles.mockResolvedValue(['user']); // non-exempt by default
});

describe('checkRateLimit', () => {
  test('admin is exempt - allowed with no config/log query at all', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['admin']);

    const result = await checkRateLimit('u1');

    expect(result).toEqual({ allowed: true, exempt: true, limit: -1, windowMinutes: -1, usedInWindow: 0 });
    expect(mockGetConfigInt).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('admin-master is exempt too', async () => {
    mockGetUserRoles.mockResolvedValueOnce(['user-premium', 'admin-master']);

    const result = await checkRateLimit('u1');

    expect(result.allowed).toBe(true);
    expect(result.exempt).toBe(true);
  });

  // Unlike fmpRateLimit.service.ts (which sums real per-call values out of a JSONB column since
  // one row there can represent many real calls), every row in this feature's log table
  // represents exactly one real, billed LLM call - counting rows IS "sum of real calls" here.
  test('counts rows in the window as the real-call total, not a summed JSONB value', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const result = await checkRateLimit('u1');

    expect(result).toEqual({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
  });

  test('an unable_to_answer outcome still counts toward the limit - the LLM was still invoked', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const result = await checkRateLimit('u1');

    // The count(*) query itself has no outcome filter - confirmed via the SQL text below, not
    // just the numeric result, since a filtered query could coincidentally return the same count.
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/outcome/);
    expect(result.usedInWindow).toBe(5);
  });

  test('blocked once usage in the window reaches the configured limit', async () => {
    mockGetConfigInt.mockResolvedValueOnce(2).mockResolvedValueOnce(10);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await checkRateLimit('u1');

    expect(result.allowed).toBe(false);
  });

  test('resolves N and M via the dedicated Config Property keys, not fmpRateLimit\'s', async () => {
    mockGetConfigInt.mockResolvedValueOnce(5).mockResolvedValueOnce(15);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await checkRateLimit('u1');

    expect(mockGetConfigInt).toHaveBeenCalledWith('candlestick_question_answer_max_questions_per_window', 10);
    expect(mockGetConfigInt).toHaveBeenCalledWith('candlestick_question_answer_rate_limit_window_minutes', 10);
  });

  test('queries user_evt_candlestick_question_answer_log, scoped to the calling user and window', async () => {
    mockGetConfigInt.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await checkRateLimit('u1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('user_evt_candlestick_question_answer_log');
    expect(sql).toContain('user_id = $1');
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe(7);
  });
});

describe('recordRateLimitedCall', () => {
  test('inserts a bare (user_id) row - the now-slimmed table has nothing else to record', async () => {
    mockQuery.mockResolvedValueOnce({});

    await recordRateLimitedCall('u1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO user_evt_candlestick_question_answer_log (user_id)');
    expect(params).toEqual(['u1']);
  });
});
