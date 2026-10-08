jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/services/configProperty.service', () => ({ getConfigInt: jest.fn() }));

import { pool } from '../src/db/pool';
import { getConfigInt } from '../src/services/configProperty.service';
import {
  getEffectivePendingTemplateLimit, getEffectiveApprovedTemplateLimit, getEffectivePortfolioLimit,
} from '../src/services/flexQuota.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockGetConfigInt = getConfigInt as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetConfigInt.mockReset();
});

describe('getEffectivePendingTemplateLimit', () => {
  test('returns the per-user override when set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_pending_templates_override: 4 }] });
    expect(await getEffectivePendingTemplateLimit('user-1')).toBe(4);
    expect(mockGetConfigInt).not.toHaveBeenCalled();
  });

  test('falls back to the global Config Property default when the override is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_pending_templates_override: null }] });
    mockGetConfigInt.mockResolvedValue(2);
    expect(await getEffectivePendingTemplateLimit('user-1')).toBe(2);
    expect(mockGetConfigInt).toHaveBeenCalledWith('portfolio_flex_max_pending_templates', 2);
  });

  test('falls back to the global default when no user row is found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockGetConfigInt.mockResolvedValue(2);
    expect(await getEffectivePendingTemplateLimit('user-1')).toBe(2);
  });
});

describe('getEffectiveApprovedTemplateLimit', () => {
  test('returns the per-user override when set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_approved_templates_override: 8 }] });
    expect(await getEffectiveApprovedTemplateLimit('user-1')).toBe(8);
  });

  test('falls back to the global default when the override is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_approved_templates_override: null }] });
    mockGetConfigInt.mockResolvedValue(5);
    expect(await getEffectiveApprovedTemplateLimit('user-1')).toBe(5);
    expect(mockGetConfigInt).toHaveBeenCalledWith('portfolio_flex_max_approved_templates', 5);
  });
});

describe('getEffectivePortfolioLimit', () => {
  test('returns the per-user override when set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_portfolios_override: 12 }] });
    expect(await getEffectivePortfolioLimit('user-1')).toBe(12);
  });

  test('falls back to the global default when the override is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_portfolios_override: null }] });
    mockGetConfigInt.mockResolvedValue(6);
    expect(await getEffectivePortfolioLimit('user-1')).toBe(6);
    expect(mockGetConfigInt).toHaveBeenCalledWith('portfolio_flex_max_portfolios', 6);
  });

  test('treats an override of 0 as a real value, not "unset"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ flex_max_portfolios_override: 0 }] });
    expect(await getEffectivePortfolioLimit('user-1')).toBe(0);
    expect(mockGetConfigInt).not.toHaveBeenCalled();
  });
});
