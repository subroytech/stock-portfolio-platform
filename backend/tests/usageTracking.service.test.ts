jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../src/db/pool';
import { logUsage } from '../src/services/usageTracking.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => mockQuery.mockReset());

test('inserts a raw event row and upserts the monthly summary row', async () => {
  mockQuery.mockResolvedValue({ rows: [] });

  await logUsage('1', 'contrarian_finder_scan');

  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO user_evt_usage');
  expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'contrarian_finder_scan']);
  expect(mockQuery.mock.calls[1][0]).toContain('user_evt_usage_summary_monthly');
  expect(mockQuery.mock.calls[1][0]).toContain('ON CONFLICT');
  expect(mockQuery.mock.calls[1][1]).toEqual(['1', 'contrarian_finder_scan']);
});

test('rejects (caller is responsible for fire-and-forget handling) when the insert fails', async () => {
  mockQuery.mockRejectedValue(new Error('db exploded'));
  await expect(logUsage('1', 'momentum')).rejects.toThrow('db exploded');
});
