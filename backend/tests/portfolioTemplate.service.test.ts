jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  listApprovedTemplates, listMyPending, listAllTemplates, getTemplateDetail, getTemplateParseConfig, createTemplate,
  setTemplateStatus, validateTemplateName, InvalidTemplateNameError, DuplicateTemplateNameError,
  TemplateNotFoundError,
} from '../src/services/portfolioTemplate.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('validateTemplateName', () => {
  test('trims and returns a valid name', () => {
    expect(validateTemplateName('  Fidelity CSV  ')).toBe('Fidelity CSV');
  });

  test('rejects a name shorter than 3 characters after trimming', () => {
    expect(() => validateTemplateName('  ab  ')).toThrow(InvalidTemplateNameError);
  });

  test('rejects an all-numeric/no-letter name', () => {
    expect(() => validateTemplateName('12345')).toThrow(InvalidTemplateNameError);
  });

  test('rejects whitespace-only input', () => {
    expect(() => validateTemplateName('     ')).toThrow(InvalidTemplateNameError);
  });
});

describe('listApprovedTemplates', () => {
  test('queries Approved templates filtered to admin/admin-master/self, with an optional search term', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', template_name: 'Fidelity', status: 'Approved', created_by: 'user-1', created_at: '2026-08-06T00:00:00Z', how_to_use_description: 'Headers on row 1' }] });
    const result = await listApprovedTemplates('user-1', 'fid');
    expect(result).toEqual([{ id: '1', templateName: 'Fidelity', status: 'Approved', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z', howToUseDescription: 'Headers on row 1' }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'Approved'");
    expect(sql).toContain("r.name IN ('admin', 'admin-master')");
    expect(sql).toContain('how_to_use_description');
    expect(params).toEqual(['user-1', 'fid']);
  });

  test('passes null search when omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listApprovedTemplates('user-1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', null]);
  });
});

describe('listMyPending', () => {
  test('queries only the caller\'s own Pending Approval templates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '2', template_name: 'My Draft', status: 'Pending Approval', created_by: 'user-1', created_at: '2026-08-06T00:00:00Z', how_to_use_description: null }] });
    const result = await listMyPending('user-1');
    expect(result).toEqual([{ id: '2', templateName: 'My Draft', status: 'Pending Approval', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z', howToUseDescription: null }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'Pending Approval' AND created_by = $1");
    expect(sql).toContain('how_to_use_description');
    expect(params).toEqual(['user-1']);
  });
});

describe('listAllTemplates', () => {
  test('queries every template regardless of status/creator, pending-first', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', template_name: 'A', status: 'Pending Approval', created_by: 'user-1', created_at: '2026-08-06T00:00:00Z', how_to_use_description: null },
        { id: '2', template_name: 'B', status: 'Approved', created_by: 'user-2', created_at: '2026-08-05T00:00:00Z', how_to_use_description: 'Schwab export' },
      ],
    });
    const result = await listAllTemplates();
    expect(result).toEqual([
      { id: '1', templateName: 'A', status: 'Pending Approval', createdBy: 'user-1', createdAt: '2026-08-06T00:00:00Z', howToUseDescription: null },
      { id: '2', templateName: 'B', status: 'Approved', createdBy: 'user-2', createdAt: '2026-08-05T00:00:00Z', howToUseDescription: 'Schwab export' },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('how_to_use_description');
    expect(params).toBeUndefined();
  });
});

describe('getTemplateDetail', () => {
  test('returns master fields + the reconstructed column mapping', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: '1', template_name: 'Fidelity', status: 'Approved', created_by: 'user-1',
            reviewed_by: 'admin-1', reviewed_at: '2026-08-06T01:00:00Z', sample_preview: [{ symbol: 'AAPL' }],
            created_at: '2026-08-06T00:00:00Z', header_row_index: 3, data_start_column_index: 2,
            how_to_use_description: 'Schwab export — headers on row 3',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ target_field: 'symbol', source_header: 'Ticker' }, { target_field: 'quantity', source_header: 'Shares' }] }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    const result = await getTemplateDetail('1');
    expect(result).toEqual({
      id: '1', templateName: 'Fidelity', status: 'Approved', createdBy: 'user-1',
      createdAt: '2026-08-06T00:00:00Z', reviewedBy: 'admin-1', reviewedAt: '2026-08-06T01:00:00Z',
      samplePreview: [{ symbol: 'AAPL' }], columnMapping: { symbol: 'Ticker', quantity: 'Shares' },
      headerRowIndex: 3, dataStartColumnIndex: 2, howToUseDescription: 'Schwab export — headers on row 3',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('throws TemplateNotFoundError when the master row does not exist', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }), release: jest.fn() };
    mockConnect.mockResolvedValue(client);
    await expect(getTemplateDetail('999')).rejects.toThrow(TemplateNotFoundError);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('getTemplateParseConfig', () => {
  test('returns the mapping plus header row/data start column reconstructed from master + dtls rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ header_row_index: 3, data_start_column_index: 2 }] })
      .mockResolvedValueOnce({ rows: [{ target_field: 'symbol', source_header: 'Ticker' }] });
    expect(await getTemplateParseConfig('1')).toEqual({
      columnMapping: { symbol: 'Ticker' }, headerRowIndex: 3, dataStartColumnIndex: 2,
    });
  });

  test('defaults to (1, 1) for a pre-migration template row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ header_row_index: 1, data_start_column_index: 1 }] })
      .mockResolvedValueOnce({ rows: [{ target_field: 'symbol', source_header: 'Ticker' }] });
    const result = await getTemplateParseConfig('1');
    expect(result.headerRowIndex).toBe(1);
    expect(result.dataStartColumnIndex).toBe(1);
  });

  test('throws TemplateNotFoundError when the master row does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getTemplateParseConfig('999')).rejects.toThrow(TemplateNotFoundError);
  });

  test('does not incorrectly 404 a template whose mapping is legally empty (existence keyed off the master row, not dtls)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ header_row_index: 1, data_start_column_index: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await getTemplateParseConfig('1')).toEqual({ columnMapping: {}, headerRowIndex: 1, dataStartColumnIndex: 1 });
  });
});

describe('createTemplate', () => {
  const input = {
    templateName: 'Fidelity CSV',
    columnMapping: { symbol: 'Ticker', quantity: 'Shares' },
    samplePreview: [{ symbol: 'AAPL' }],
    createdBy: 'user-1',
    headerRowIndex: 1,
    dataStartColumnIndex: 1,
  };

  test('inserts master + dtls rows in one transaction, lands at Pending Approval', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: '1', created_at: '2026-08-06T00:00:00Z' }] }) // master INSERT
        .mockResolvedValueOnce(undefined) // dtls INSERT
        .mockResolvedValueOnce(undefined), // COMMIT
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    const result = await createTemplate(input);
    expect(result).toEqual({
      id: '1', templateName: 'Fidelity CSV', status: 'Pending Approval', createdBy: 'user-1',
      createdAt: '2026-08-06T00:00:00Z', howToUseDescription: null,
    });

    const [masterSql, masterParams] = client.query.mock.calls[1];
    expect(masterSql).toContain('header_row_index');
    expect(masterSql).toContain('data_start_column_index');
    expect(masterSql).toContain('how_to_use_description');
    expect(masterParams).toEqual(['Fidelity CSV', 'user-1', JSON.stringify(input.samplePreview), 1, 1, null]);

    const [dtlsSql, dtlsParams] = client.query.mock.calls[2];
    expect(dtlsSql).toContain('INSERT INTO m_portfolio_template_mapping_dtls');
    expect(dtlsParams).toEqual(['1', 'symbol', 'Ticker', '1', 'quantity', 'Shares']);
    expect(client.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('persists a non-default header row/data start column and a how-to-use description', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: '2', created_at: '2026-08-06T00:00:00Z' }] }) // master INSERT
        .mockResolvedValueOnce(undefined) // dtls INSERT
        .mockResolvedValueOnce(undefined), // COMMIT
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    const result = await createTemplate({
      ...input, headerRowIndex: 3, dataStartColumnIndex: 2, howToUseDescription: 'Schwab export — headers on row 3',
    });
    expect(result.howToUseDescription).toBe('Schwab export — headers on row 3');

    const [, masterParams] = client.query.mock.calls[1];
    expect(masterParams).toEqual(['Fidelity CSV', 'user-1', JSON.stringify(input.samplePreview), 3, 2, 'Schwab export — headers on row 3']);
  });

  test('rejects an invalid name before ever opening a transaction', async () => {
    await expect(createTemplate({ ...input, templateName: '12' })).rejects.toThrow(InvalidTemplateNameError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('maps a unique-violation on template_name to DuplicateTemplateNameError and rolls back', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce({ code: '23505' }) // master INSERT - duplicate name
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    await expect(createTemplate(input)).rejects.toThrow(DuplicateTemplateNameError);
    expect(client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('setTemplateStatus', () => {
  test('updates status/reviewed_by/reviewed_at', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await setTemplateStatus('1', 'Approved', 'admin-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('SET status = $1, reviewed_by = $2, reviewed_at = now()');
    expect(params).toEqual(['Approved', 'admin-1', '1']);
  });

  test('throws TemplateNotFoundError when no row matched', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    await expect(setTemplateStatus('999', 'Rejected', 'admin-1')).rejects.toThrow(TemplateNotFoundError);
  });
});
