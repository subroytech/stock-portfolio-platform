jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  listFunctions, createFunction, updateFunctionStatus, InvalidStatusError, DuplicateFunctionError,
} from '../src/services/functionMaster.service';

const mockQuery = pool.query as unknown as jest.Mock;

const dbRow = { id: '1', permission_key: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' };
const mappedRow = { id: '1', permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' };

beforeEach(() => {
  mockQuery.mockReset();
});

describe('listFunctions', () => {
  test('activeOnly true filters to active/QA-Test in SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    expect(await listFunctions({ activeOnly: true })).toEqual([mappedRow]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("IN ('active', 'QA-Test')"));
  });

  test('activeOnly false returns every row regardless of status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    expect(await listFunctions({ activeOnly: false })).toEqual([mappedRow]);
    expect(mockQuery).toHaveBeenCalledWith(expect.not.stringContaining('WHERE'));
  });
});

describe('createFunction', () => {
  test('inserts and returns the new function, mapped to camelCase', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dbRow] });
    const result = await createFunction({ permissionKey: 'roles:manage', name: 'Manage Roles', description: null, status: 'active' });
    expect(result).toEqual(mappedRow);
  });

  test('throws InvalidStatusError for an unrecognized status', async () => {
    await expect(createFunction({ permissionKey: 'x:y', name: 'X', description: null, status: 'bogus' }))
      .rejects.toBeInstanceOf(InvalidStatusError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('throws DuplicateFunctionError on a unique-violation', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(createFunction({ permissionKey: 'roles:manage', name: 'Dup', description: null, status: 'active' }))
      .rejects.toBeInstanceOf(DuplicateFunctionError);
  });
});

describe('updateFunctionStatus', () => {
  test('updates and returns the row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...dbRow, status: 'inactive' }] });
    expect(await updateFunctionStatus('1', 'inactive')).toEqual({ ...mappedRow, status: 'inactive' });
  });

  test('returns null when no row matches the id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await updateFunctionStatus('999', 'inactive')).toBeNull();
  });

  test('throws InvalidStatusError for an unrecognized status, without querying', async () => {
    await expect(updateFunctionStatus('1', 'bogus')).rejects.toBeInstanceOf(InvalidStatusError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
