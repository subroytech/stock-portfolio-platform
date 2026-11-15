// Portfolio lifecycle status (Active / In-Active / Soft-Delete) - the owner's soft delete, the
// Active-only read/write guard, and the admin list / restore / permanent-delete functions.
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/marketData.service');
jest.mock('../src/services/userSubscription.service');
jest.mock('../src/services/portfolioTemplate.service');
jest.mock('../src/services/flexQuota.service');

import { pool } from '../src/db/pool';
import {
  listPortfolios, listManagedPortfolios, softDeletePortfolio, deletePortfolio,
  restorePortfolio, permanentlyDeleteSoftDeletedPortfolio,
  PortfolioStatusError, PortfolioNameConflictError,
} from '../src/services/portfolio.service';

const mockQuery = pool.query as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
});

const portfolioRow = (overrides: Record<string, unknown> = {}) => ({
  id: '7', name: 'Fidelity', broker: null, created_at: 't1', updated_at: 't2',
  upload_template_id: null, flex_template_status: null, status: 'Active', ...overrides,
});

describe('owner-facing reads only ever see Active portfolios', () => {
  test('listPortfolios filters on status = Active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [portfolioRow()] });
    const result = await listPortfolios('user-1');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/status = 'Active'/);
    expect(result[0].status).toBe('Active');
  });
});

describe('softDeletePortfolio (owner Delete action)', () => {
  test('sets status to Soft-Delete, only for the owner\'s Active portfolio', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '7' }] });
    expect(await softDeletePortfolio('user-1', '7')).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET status = 'Soft-Delete'/);
    expect(sql).toMatch(/status = 'Active'/);
    expect(params).toEqual(['7', 'user-1']);
  });

  test('returns false when nothing matched (not owner, or already not Active)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await softDeletePortfolio('user-1', '7')).toBe(false);
  });
});

describe('deletePortfolio (hard delete, narrowed to unresolved Flex creations)', () => {
  test('only deletes a Flex-Err portfolio', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await deletePortfolio('user-1', '7');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/flex_template_status = 'Flex-Err'/);
  });
});

describe('restorePortfolio (admin)', () => {
  test('returns null when the portfolio does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await restorePortfolio('999')).toBeNull();
  });

  test('refuses a portfolio that is not Soft-Delete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'Active', name: 'Fidelity' }] });
    await expect(restorePortfolio('7')).rejects.toBeInstanceOf(PortfolioStatusError);
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reaches the UPDATE
  });

  test('restores a Soft-Delete portfolio to Active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'Soft-Delete', name: 'Fidelity' }] })
      .mockResolvedValueOnce({ rows: [portfolioRow({ status: 'Active' })] });
    const restored = await restorePortfolio('7');
    expect(restored?.status).toBe('Active');
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'Active'/);
  });

  test('blocks the restore with a clear message when the name has since been taken', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'Soft-Delete', name: 'Fidelity' }] })
      .mockRejectedValueOnce(dup);
    const err = await restorePortfolio('7').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortfolioNameConflictError);
    expect((err as Error).message).toMatch(/already has an active portfolio named "Fidelity"/);
  });
});

describe('permanentlyDeleteSoftDeletedPortfolio (admin)', () => {
  test('returns false when the portfolio does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await permanentlyDeleteSoftDeletedPortfolio('999')).toBe(false);
  });

  test('refuses an Active portfolio, without issuing any DELETE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'Active' }] });
    await expect(permanentlyDeleteSoftDeletedPortfolio('7')).rejects.toBeInstanceOf(PortfolioStatusError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('deletes a Soft-Delete portfolio (child rows cascade via existing foreign keys)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'Soft-Delete' }] })
      .mockResolvedValueOnce({ rows: [{ id: '7' }] });
    expect(await permanentlyDeleteSoftDeletedPortfolio('7')).toBe(true);
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM tx_portfolios WHERE id = \$1 AND status = 'Soft-Delete'/);
  });
});

describe('listManagedPortfolios (admin, single-select filters, default sort)', () => {
  const adminRow = (overrides: Record<string, unknown> = {}) => ({
    id: '7', name: 'Fidelity', user_id: 'u1', owner_email: 'a@example.com',
    flex_template_status: null, status: 'Active', created_at: 't1', ...overrides,
  });

  test('with no filters, returns every status and sorts by user, type, status, name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [adminRow()] });
    await listManagedPortfolios({});
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(sql).toMatch(/ORDER BY u\.email,\s*CASE WHEN p\.flex_template_status IS NULL THEN 0 ELSE 1 END,\s*p\.status,\s*p\.name/);
    expect(params).toEqual([]);
  });

  test('Legacy filter means no flex_template_status; Flex filter means a non-null one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await listManagedPortfolios({ portfolioType: 'Legacy' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/p\.flex_template_status IS NULL/);
    await listManagedPortfolios({ portfolioType: 'Flex' });
    expect(mockQuery.mock.calls[1][0]).toMatch(/p\.flex_template_status IS NOT NULL/);
  });

  test('user and status filters are parameterised, and rows map to Legacy/Flex', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [adminRow({ flex_template_status: 'Flex-Err', status: 'Soft-Delete' })],
    });
    const result = await listManagedPortfolios({ userId: 'u1', status: 'Soft-Delete' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/p\.user_id = \$1/);
    expect(sql).toMatch(/p\.status = \$2/);
    expect(params).toEqual(['u1', 'Soft-Delete']);
    expect(result).toEqual([expect.objectContaining({ portfolioType: 'Flex', status: 'Soft-Delete', ownerEmail: 'a@example.com' })]);
  });
});
