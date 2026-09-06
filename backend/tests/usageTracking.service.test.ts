jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  logUsage, maybeRunDailyUsageAggregation,
  getUsageRankingLast3Days, getUsageRankingForMonth, getAvailableUsageMonths,
} from '../src/services/usageTracking.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('logUsage', () => {
  test('inserts a raw event row (api_call_details null) and upserts the monthly summary row when no detail is given', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logUsage('1', 'contrarian_finder_scan');

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO user_evt_usage');
    expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'contrarian_finder_scan', null]);
    expect(mockQuery.mock.calls[1][0]).toContain('user_evt_usage_summary_monthly');
    expect(mockQuery.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(mockQuery.mock.calls[1][1]).toEqual(['1', 'contrarian_finder_scan']);
  });

  test('stores a JSON-stringified api_call_details breakdown when given, without changing the summary upsert', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await logUsage('1', 'portfolio_refresh', { fmp_quote: 20, fmp_historical: 22 });

    expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'portfolio_refresh', JSON.stringify({ fmp_quote: 20, fmp_historical: 22 })]);
    expect(mockQuery.mock.calls[1][1]).toEqual(['1', 'portfolio_refresh']);
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

  test('no-ops (does not open a transaction) when the watermark is less than 24h old', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 1000) }] });

    await maybeRunDailyUsageAggregation();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('runs when overdue: sums multiple raw rows into the summary\'s cumulative detail, additively on top of an existing value, deletes exactly the aggregated rows by id, and advances the watermark', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }] });
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
      if (sql.includes('SELECT api_call_details FROM user_evt_usage_summary_monthly')) {
        return Promise.resolve({ rows: [{ api_call_details: { fmp_quote: 10 } }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const updateCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE user_evt_usage_summary_monthly'));
    expect(updateCall![1]).toEqual(['u1', 'portfolio_refresh', '2026-09-01', JSON.stringify({ fmp_quote: 18, fmp_historical: 5 })]);

    const deleteCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM user_evt_usage'));
    expect(deleteCall![1]).toEqual([['r1', 'r2']]);

    const watermarkUpdate = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE sys_usage_aggregation_watermark'));
    expect(watermarkUpdate).toBeTruthy();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('starts a summary row\'s detail from {} when it was previously null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 'r1', user_id: 'u1', feature: 'contrarian_finder_scan', month: '2026-09-01', api_call_details: { fmp_quote: 15 } }] });
      }
      if (sql.includes('SELECT api_call_details FROM user_evt_usage_summary_monthly')) {
        return Promise.resolve({ rows: [{ api_call_details: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const updateCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE user_evt_usage_summary_monthly'));
    expect(updateCall![1]).toEqual(['u1', 'contrarian_finder_scan', '2026-09-01', JSON.stringify({ fmp_quote: 15 })]);
  });

  test('when no raw rows have detail, skips the merge/delete steps but still advances the watermark', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }] });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }] });
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

  // User Usage Dashboard - "Last 3 Days" needs a full 3 days of raw detail to still exist, so
  // a row is only folded into the summary and deleted once it's older than 3 days.
  test('only selects/deletes detail rows older than 3 days, never rows still inside the display window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ last_aggregated_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }] });
    const client = mockClient();
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await maybeRunDailyUsageAggregation();

    const selectCall = client.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('FOR UPDATE'));
    expect(selectCall![0]).toContain("created_at < now() - interval '3 days'");
  });
});

describe('getUsageRankingLast3Days', () => {
  test('sums real API-call counts where known, falls back to 1 per event otherwise, and sorts descending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', email: 'heavy@b.com', feature: 'portfolio_refresh', api_call_details: { fmp_quote: 5, fmp_historical: 3 } },
        { user_id: 'u1', email: 'heavy@b.com', feature: 'momentum', api_call_details: null },
        { user_id: 'u2', email: 'light@b.com', feature: 'momentum', api_call_details: null },
        { user_id: 'u3', email: 'idle@b.com', feature: null, api_call_details: null },
      ],
    });

    const result = await getUsageRankingLast3Days();

    expect(result).toEqual([
      { userId: 'u1', email: 'heavy@b.com', totalScore: 9, byFeature: { portfolio_refresh: 8, momentum: 1 } },
      { userId: 'u2', email: 'light@b.com', totalScore: 1, byFeature: { momentum: 1 } },
      { userId: 'u3', email: 'idle@b.com', totalScore: 0, byFeature: {} },
    ]);
  });

  test('queries a rolling 3-day window via a LEFT JOIN from users, so zero-usage users are never omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getUsageRankingLast3Days();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN user_evt_usage');
    expect(sql).toContain("now() - interval '3 days'");
  });
});

describe('getUsageRankingForMonth', () => {
  test('sums real API-call counts where known, falls back to event_count otherwise (not a flat 1), and sorts descending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', email: 'heavy@b.com', feature: 'contrarian_finder_scan', event_count: '3', api_call_details: { fmp_quote: 300 } },
        { user_id: 'u2', email: 'light@b.com', feature: 'momentum', event_count: '5', api_call_details: null },
        { user_id: 'u3', email: 'idle@b.com', feature: null, event_count: null, api_call_details: null },
      ],
    });

    const result = await getUsageRankingForMonth('2026-09-01');

    expect(result).toEqual([
      { userId: 'u1', email: 'heavy@b.com', totalScore: 300, byFeature: { contrarian_finder_scan: 300 } },
      { userId: 'u2', email: 'light@b.com', totalScore: 5, byFeature: { momentum: 5 } },
      { userId: 'u3', email: 'idle@b.com', totalScore: 0, byFeature: {} },
    ]);
  });

  test('passes the requested month as a query parameter', async () => {
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
