jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  logUsage, maybeRunDailyUsageAggregation, getUsageAggregationCutoff,
  getUsageRankingLast3Days, getUsageRankingForDay, getUsageRankingForMonth, getAvailableUsageMonths,
} from '../src/services/usageTracking.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('logUsage', () => {
  test('inserts a raw event row (api_call_details null) and does not touch the monthly summary', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logUsage('1', 'contrarian_finder_scan');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO user_evt_usage');
    expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'contrarian_finder_scan', null]);
  });

  test('stores a JSON-stringified api_call_details breakdown when given', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logUsage('1', 'portfolio_refresh', { fmp_quote: 20, fmp_historical: 22 });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'portfolio_refresh', JSON.stringify({ fmp_quote: 20, fmp_historical: 22 })]);
  });

  test('rejects (caller is responsible for fire-and-forget handling) when the insert fails', async () => {
    mockQuery.mockRejectedValue(new Error('db exploded'));
    await expect(logUsage('1', 'momentum')).rejects.toThrow('db exploded');
  });
});

describe('maybeRunDailyUsageAggregation', () => {
  function mockClient() {
    const client = { query: jest.fn(), release: jest.fn() };
    mockConnect.mockResolvedValue(client);
    return client;
  }

  test('no-ops (does not open a transaction) when last_aggregated_at already falls on today\'s ET calendar date', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-12', today_date: '2026-09-12' }] });

    await maybeRunDailyUsageAggregation();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('runs once the ET calendar date has changed, regardless of how many literal hours elapsed (e.g. last run 09/11 11PM ET, login 09/12 11AM ET - only ~12h)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [
            { id: 'r1', user_id: 'u1', feature: 'portfolio_refresh', month: '2026-09-01', api_call_details: { fmp_quote: 5, fmp_historical: 5 } },
            { id: 'r2', user_id: 'u1', feature: 'portfolio_refresh', month: '2026-09-01', api_call_details: { fmp_quote: 3 } },
          ],
        });
      }
      if (sql.includes('SELECT event_count, api_call_details FROM user_evt_usage_summary_monthly')) {
        return Promise.resolve({ rows: [{ event_count: '5', api_call_details: { fmp_quote: 10 } }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const upsertCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO user_evt_usage_summary_monthly'));
    expect(upsertCall![1]).toEqual(['u1', 'portfolio_refresh', '2026-09-01', 7, JSON.stringify({ fmp_quote: 18, fmp_historical: 5 })]);

    const deleteCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM user_evt_usage'));
    expect(deleteCall![1]).toEqual([['r1', 'r2']]);

    const watermarkUpdate = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE sys_usage_aggregation_watermark'));
    expect(watermarkUpdate).toBeTruthy();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('creates a brand-new summary row (event_count from scratch, detail from {}) when none existed before', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 'r1', user_id: 'u1', feature: 'contrarian_finder_scan', month: '2026-09-01', api_call_details: { fmp_quote: 15 } }] });
      }
      if (sql.includes('SELECT event_count, api_call_details FROM user_evt_usage_summary_monthly')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const upsertCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO user_evt_usage_summary_monthly'));
    expect(upsertCall![1]).toEqual(['u1', 'contrarian_finder_scan', '2026-09-01', 1, JSON.stringify({ fmp_quote: 15 })]);
  });

  test('counts and deletes rows even when they carry no api_call_details at all - event_count still advances, detail stays null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 'r1', user_id: 'u1', feature: 'momentum', month: '2026-09-01', api_call_details: null }] });
      }
      if (sql.includes('SELECT event_count, api_call_details FROM user_evt_usage_summary_monthly')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const upsertCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO user_evt_usage_summary_monthly'));
    expect(upsertCall![1]).toEqual(['u1', 'momentum', '2026-09-01', 1, null]);

    const deleteCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM user_evt_usage'));
    expect(deleteCall![1]).toEqual([['r1']]);
  });

  test('when there are no rows older than 3 days, skips the merge/delete steps but still advances the watermark', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    expect(client.query.mock.calls.some((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM user_evt_usage'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rolls back and rethrows on failure, still releasing the client', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) return Promise.reject(new Error('boom'));
      if (sql === 'ROLLBACK') return Promise.resolve();
      return Promise.resolve({ rows: [] });
    });

    await expect(maybeRunDailyUsageAggregation()).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('treats a never-before-run watermark (no row) as overdue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const client = mockClient();
    client.query.mockResolvedValue({ rows: [] });

    await maybeRunDailyUsageAggregation();

    expect(mockConnect).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  // User Usage Dashboard - "Last 3 Days" needs a full 3 days of raw detail to still exist, so a
  // row (with or without api_call_details) is only folded into the summary and deleted once
  // it's older than 3 days.
  test('only selects/deletes rows older than 3 days, never rows still inside the display window, regardless of whether they carry detail', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_date: '2026-09-11', today_date: '2026-09-12' }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const selectCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('FOR UPDATE'));
    expect(selectCall![0]).toContain("created_at < now() - interval '3 days'");
    expect(selectCall![0]).not.toContain('api_call_details IS NOT NULL');
  });
});

describe('getUsageAggregationCutoff', () => {
  test('returns the watermark minus 3 days, as an ISO string', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cutoff: new Date('2026-09-04T10:00:00Z') }] });
    expect(await getUsageAggregationCutoff()).toBe('2026-09-04T10:00:00.000Z');
    expect(mockQuery.mock.calls[0][0]).toContain("interval '3 days'");
  });

  test('returns null when the sweep has never run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cutoff: null }] });
    expect(await getUsageAggregationCutoff()).toBeNull();
  });

  test('returns null when there is no watermark row at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUsageAggregationCutoff()).toBeNull();
  });
});

describe('getUsageRankingLast3Days', () => {
  test('reports Function Calls (1 per event) and FMP/Finnhub Calls split by key prefix, sorts descending by combined API volume, and attaches each user\'s roles from a separate query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', email: 'heavy@b.com', feature: 'portfolio_refresh', api_call_details: { fmp_quote: 5, fmp_historical: 3 } },
        { user_id: 'u1', email: 'heavy@b.com', feature: 'long_term_analysis', api_call_details: { fmp: 2, finnhub: 1 } },
        { user_id: 'u2', email: 'light@b.com', feature: 'momentum', api_call_details: null },
        { user_id: 'u3', email: 'idle@b.com', feature: null, api_call_details: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', name: 'admin' },
        { user_id: 'u2', name: 'user' },
      ],
    });

    const result = await getUsageRankingLast3Days();

    expect(result).toEqual([
      {
        userId: 'u1', email: 'heavy@b.com', roles: ['admin'], totalFunctionCalls: 2, totalFmpCalls: 10, totalFinnhubCalls: 1,
        byFeature: {
          portfolio_refresh: { functionCalls: 1, fmpCalls: 8, finnhubCalls: 0 },
          long_term_analysis: { functionCalls: 1, fmpCalls: 2, finnhubCalls: 1 },
        },
      },
      {
        userId: 'u2', email: 'light@b.com', roles: ['user'], totalFunctionCalls: 1, totalFmpCalls: 0, totalFinnhubCalls: 0,
        byFeature: { momentum: { functionCalls: 1, fmpCalls: 0, finnhubCalls: 0 } },
      },
      { userId: 'u3', email: 'idle@b.com', roles: [], totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} },
    ]);
  });

  test('queries a rolling 3-day window via a LEFT JOIN from users, so zero-usage users are never omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getUsageRankingLast3Days();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN user_evt_usage');
    expect(sql).toContain("now() - interval '3 days'");
  });
});

describe('getUsageRankingForDay', () => {
  test('reports a single calendar day\'s usage and attaches roles, same shape as the other ranking functions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', email: 'heavy@b.com', feature: 'momentum', api_call_details: { fmp_quote: 4 } },
        { user_id: 'u2', email: 'idle@b.com', feature: null, api_call_details: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', name: 'user' }] });

    const result = await getUsageRankingForDay(1);

    expect(result).toEqual([
      {
        userId: 'u1', email: 'heavy@b.com', roles: ['user'], totalFunctionCalls: 1, totalFmpCalls: 4, totalFinnhubCalls: 0,
        byFeature: { momentum: { functionCalls: 1, fmpCalls: 4, finnhubCalls: 0 } },
      },
      { userId: 'u2', email: 'idle@b.com', roles: [], totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} },
    ]);
  });

  test('bounds the window to a single calendar day at the given offset, via a LEFT JOIN from users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getUsageRankingForDay(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN user_evt_usage');
    expect(sql).toContain("date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2");
    expect(params).toEqual([2, 'America/New_York']);
  });
});

describe('getUsageRankingForMonth', () => {
  test('reports event_count as Function Calls and FMP/Finnhub Calls split by key prefix, sorted descending by combined API volume, and attaches each user\'s roles from a separate query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', email: 'heavy@b.com', feature: 'contrarian_finder_scan', event_count: '3', api_call_details: { fmp_quote: 300 } },
        { user_id: 'u2', email: 'mid@b.com', feature: 'long_term_analysis', event_count: '2', api_call_details: { fmp: 10, finnhub: 5 } },
        { user_id: 'u3', email: 'idle@b.com', feature: null, event_count: null, api_call_details: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', name: 'admin-master' },
      ],
    });

    const result = await getUsageRankingForMonth('2026-09-01');

    expect(result).toEqual([
      {
        userId: 'u1', email: 'heavy@b.com', roles: ['admin-master'], totalFunctionCalls: 3, totalFmpCalls: 300, totalFinnhubCalls: 0,
        byFeature: { contrarian_finder_scan: { functionCalls: 3, fmpCalls: 300, finnhubCalls: 0 } },
      },
      {
        userId: 'u2', email: 'mid@b.com', roles: [], totalFunctionCalls: 2, totalFmpCalls: 10, totalFinnhubCalls: 5,
        byFeature: { long_term_analysis: { functionCalls: 2, fmpCalls: 10, finnhubCalls: 5 } },
      },
      { userId: 'u3', email: 'idle@b.com', roles: [], totalFunctionCalls: 0, totalFmpCalls: 0, totalFinnhubCalls: 0, byFeature: {} },
    ]);
  });

  test('passes the requested month as a query parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getUsageRankingForMonth('2026-08-01');
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['2026-08-01']);
  });
});

describe('getAvailableUsageMonths', () => {
  test('returns the distinct months in descending order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ month: '2026-09-01' }, { month: '2026-08-01' }] });
    expect(await getAvailableUsageMonths()).toEqual(['2026-09-01', '2026-08-01']);
  });
});
