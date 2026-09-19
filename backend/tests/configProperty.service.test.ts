jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  listGroups, createGroup, updateGroup, listProperties, getProperty, createProperty,
  updatePropertyMetadata, setPropertyValue, listPropertyValueHistory, getConfigValue, getConfigInt,
  getConfigStringList, isValidValueType, InvalidValueTypeError, InvalidConfigValueError, DuplicateConfigGroupError,
  DuplicatePropertyKeyError,
} from '../src/services/configProperty.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('isValidValueType', () => {
  test('accepts integer and string', () => {
    expect(isValidValueType('integer')).toBe(true);
    expect(isValidValueType('string')).toBe(true);
  });

  test('rejects anything else, including the deferred "date" type', () => {
    expect(isValidValueType('date')).toBe(false);
    expect(isValidValueType('boolean')).toBe(false);
    expect(isValidValueType('')).toBe(false);
  });
});

describe('listGroups', () => {
  test('returns groups ordered by name, mapped to camelCase', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', name: 'Data Retention Policies', description: 'desc', created_at: 'a', updated_at: 'b' }],
    });
    const result = await listGroups();
    expect(result).toEqual([{ id: '1', name: 'Data Retention Policies', description: 'desc', createdAt: 'a', updatedAt: 'b' }]);
  });
});

describe('createGroup', () => {
  test('inserts and returns the new group', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', name: 'Limits', description: null, created_at: 'a', updated_at: 'a' }] });
    const result = await createGroup({ name: 'Limits', description: null });
    expect(result.name).toBe('Limits');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO m_config_group');
    expect(params).toEqual(['Limits', null]);
  });

  test('throws DuplicateConfigGroupError on a unique-violation', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(createGroup({ name: 'Limits', description: null })).rejects.toBeInstanceOf(DuplicateConfigGroupError);
  });
});

describe('updateGroup', () => {
  test('returns null when the group does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await updateGroup('999', { name: 'X', description: null })).toBeNull();
  });

  test('returns the updated group on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', name: 'Renamed', description: null, created_at: 'a', updated_at: 'b' }] });
    const result = await updateGroup('1', { name: 'Renamed', description: null });
    expect(result?.name).toBe('Renamed');
  });

  test('throws DuplicateConfigGroupError on a unique-violation', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(updateGroup('1', { name: 'Taken', description: null })).rejects.toBeInstanceOf(DuplicateConfigGroupError);
  });
});

function mockPropertyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    group_id: '1',
    group_name: 'Data Retention Policies',
    property_key: 'contrarian_finder_admin_history_retention_count',
    name: 'Contrarian Finder Admin History Retention Count',
    description: null,
    value_type: 'integer',
    min_value: '1',
    max_value: '500',
    status: 'active',
    created_at: 'a',
    updated_at: 'a',
    current_value: '60',
    current_version: '1',
    ...overrides,
  };
}

describe('listProperties', () => {
  test('filters by groupId when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockPropertyRow()] });
    const result = await listProperties({ groupId: '1' });
    expect(result[0].currentVersion).toBe(1); // string 'current_version' coerced to a real number
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE p.group_id = $1');
    expect(params).toEqual(['1']);
  });

  test('lists every property when no groupId is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listProperties();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toBeUndefined();
  });
});

describe('getProperty', () => {
  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getProperty('999')).toBeNull();
  });

  test('returns the mapped row when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockPropertyRow()] });
    const result = await getProperty('1');
    expect(result?.propertyKey).toBe('contrarian_finder_admin_history_retention_count');
  });
});

describe('createProperty', () => {
  const validInput = {
    groupId: '1', propertyKey: 'max_portfolios_allowed', name: 'Max Portfolios Allowed', description: null,
    valueType: 'integer', minValue: '1', maxValue: '100', status: 'active', initialValue: '10', changedBy: 'user-1',
  };

  test('throws InvalidValueTypeError for an unknown value_type before opening a transaction', async () => {
    await expect(createProperty({ ...validInput, valueType: 'date' })).rejects.toBeInstanceOf(InvalidValueTypeError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('throws InvalidConfigValueError when the initial value fails validation, before opening a transaction', async () => {
    await expect(createProperty({ ...validInput, initialValue: 'not-a-number' })).rejects.toBeInstanceOf(InvalidConfigValueError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('throws InvalidConfigValueError when the initial value is outside the declared range', async () => {
    await expect(createProperty({ ...validInput, initialValue: '9999' })).rejects.toBeInstanceOf(InvalidConfigValueError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('creates the property and its initial value row in one transaction, then re-reads it', async () => {
    const client = {
      query: jest.fn((sql: string) => {
        if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
        if (sql.includes('INSERT INTO m_config_property ')) return Promise.resolve({ rows: [{ id: '1' }] });
        if (sql.includes('INSERT INTO m_config_property_value')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);
    mockQuery.mockResolvedValueOnce({ rows: [mockPropertyRow({ id: '1', property_key: 'max_portfolios_allowed' })] }); // getProperty re-read

    const result = await createProperty(validInput);

    expect(result.propertyKey).toBe('max_portfolios_allowed');
    const calls = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((sql) => sql.includes('INSERT INTO m_config_property '))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO m_config_property_value'))).toBe(true);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('throws DuplicatePropertyKeyError on a unique-violation and rolls back', async () => {
    const client = {
      query: jest.fn((sql: string) => {
        if (sql.startsWith('BEGIN') || sql === 'ROLLBACK') return Promise.resolve({});
        if (sql.includes('INSERT INTO m_config_property ')) return Promise.reject({ code: '23505' });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    await expect(createProperty(validInput)).rejects.toBeInstanceOf(DuplicatePropertyKeyError);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('updatePropertyMetadata', () => {
  test('returns null when the property does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await updatePropertyMetadata('999', { name: 'X', description: null, minValue: null, maxValue: null, status: 'active' })).toBeNull();
  });

  test('updates and re-reads the property on success', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [mockPropertyRow({ name: 'Renamed' })] });
    const result = await updatePropertyMetadata('1', { name: 'Renamed', description: null, minValue: null, maxValue: null, status: 'active' });
    expect(result?.name).toBe('Renamed');
  });
});

describe('setPropertyValue', () => {
  test('returns null when the property does not exist, without opening a transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the property-type lookup
    const result = await setPropertyValue('999', { value: '30', changedBy: 'user-1' });
    expect(result).toBeNull();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('throws InvalidConfigValueError for an out-of-range value, without opening a transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value_type: 'integer', min_value: '1', max_value: '500' }] });
    await expect(setPropertyValue('1', { value: '9999', changedBy: 'user-1' })).rejects.toBeInstanceOf(InvalidConfigValueError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('flips the previous active row to inactive and inserts the new one as active, in a transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value_type: 'integer', min_value: '1', max_value: '500' }] }); // the property-type lookup

    const client = {
      query: jest.fn((sql: string) => {
        if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
        if (sql.includes('COALESCE(MAX(version)')) return Promise.resolve({ rows: [{ next_version: '2' }] });
        if (sql.startsWith('UPDATE m_config_property_value SET is_active = false')) return Promise.resolve({});
        if (sql.startsWith('INSERT INTO m_config_property_value')) {
          return Promise.resolve({
            rows: [{ id: '2', property_id: '1', value: '30', version: '2', effective_timestamp: 't', is_active: true, changed_by: 'user-1', created_at: 't' }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    const result = await setPropertyValue('1', { value: '30', changedBy: 'user-1' });

    expect(result).toEqual({
      id: '2', propertyId: '1', value: '30', version: 2, effectiveTimestamp: 't', isActive: true,
      changedBy: 'user-1', changedByEmail: null, createdAt: 't',
    });
    const calls = client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const flipIndex = calls.findIndex((sql) => sql.startsWith('UPDATE m_config_property_value SET is_active = false'));
    const insertIndex = calls.findIndex((sql) => sql.startsWith('INSERT INTO m_config_property_value'));
    expect(flipIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(flipIndex); // flip must run before the new row is inserted
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('accepts any non-empty string for a string-type property, ignoring min/max', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value_type: 'string', min_value: null, max_value: null }] });
    const client = {
      query: jest.fn((sql: string) => {
        if (sql.includes('COALESCE(MAX(version)')) return Promise.resolve({ rows: [{ next_version: '1' }] });
        if (sql.startsWith('INSERT INTO m_config_property_value')) {
          return Promise.resolve({
            rows: [{ id: '1', property_id: '1', value: 'hello', version: '1', effective_timestamp: 't', is_active: true, changed_by: 'user-1', created_at: 't' }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    const result = await setPropertyValue('1', { value: 'hello', changedBy: 'user-1' });
    expect(result?.value).toBe('hello');
  });

  // api_key_fallback_eligible_roles (migration 029) is the one property whose value is
  // validated against a second, unrelated table (m_roles) - a deliberate, narrow exception
  // scoped to this specific property_key, not a general mechanism.
  describe('role-list validation (api_key_fallback_eligible_roles)', () => {
    test('rejects a value containing an unknown role name, without opening a transaction', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ property_key: 'api_key_fallback_eligible_roles', value_type: 'string', min_value: null, max_value: null }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }, { name: 'admin' }] }); // m_roles lookup - 'typo-role' not found

      await expect(setPropertyValue('1', { value: 'user,admin,typo-role', changedBy: 'user-1' }))
        .rejects.toThrow(/Unknown role name\(s\): typo-role/);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    test('accepts a value where every role name resolves in m_roles', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ property_key: 'api_key_fallback_eligible_roles', value_type: 'string', min_value: null, max_value: null }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ name: 'user' }, { name: 'admin' }, { name: 'user-contra-wokey' }, { name: 'user-premium' }] });

      const client = {
        query: jest.fn((sql: string) => {
          if (sql.includes('COALESCE(MAX(version)')) return Promise.resolve({ rows: [{ next_version: '2' }] });
          if (sql.startsWith('INSERT INTO m_config_property_value')) {
            return Promise.resolve({
              rows: [{ id: '2', property_id: '1', value: 'user,admin,user-contra-wokey,user-premium', version: '2', effective_timestamp: 't', is_active: true, changed_by: 'user-1', created_at: 't' }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };
      mockConnect.mockResolvedValue(client);

      const result = await setPropertyValue('1', { value: 'user,admin,user-contra-wokey,user-premium', changedBy: 'user-1' });
      expect(result?.value).toBe('user,admin,user-contra-wokey,user-premium');
    });

    test('does not run the role-name check for any other property key', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ property_key: 'contrarian_finder_admin_history_retention_count', value_type: 'integer', min_value: '1', max_value: '500' }] });
      const client = {
        query: jest.fn((sql: string) => {
          if (sql.includes('COALESCE(MAX(version)')) return Promise.resolve({ rows: [{ next_version: '2' }] });
          if (sql.startsWith('INSERT INTO m_config_property_value')) {
            return Promise.resolve({
              rows: [{ id: '2', property_id: '1', value: '30', version: '2', effective_timestamp: 't', is_active: true, changed_by: 'user-1', created_at: 't' }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };
      mockConnect.mockResolvedValue(client);

      await setPropertyValue('1', { value: '30', changedBy: 'user-1' });
      // Only the property-type lookup ran against pool.query - no m_roles lookup for an
      // unrelated property key.
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});

describe('listPropertyValueHistory', () => {
  test('returns history rows newest-version-first, with the changer\'s email joined in', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '2', property_id: '1', value: '30', version: '2', effective_timestamp: 't2', is_active: true, changed_by: 'user-1', created_at: 't2', changed_by_email: 'a@x.com' },
        { id: '1', property_id: '1', value: '60', version: '1', effective_timestamp: 't1', is_active: false, changed_by: null, created_at: 't1', changed_by_email: null },
      ],
    });
    const result = await listPropertyValueHistory('1');
    expect(result[0]).toEqual({
      id: '2', propertyId: '1', value: '30', version: 2, effectiveTimestamp: 't2', isActive: true,
      changedBy: 'user-1', changedByEmail: 'a@x.com', createdAt: 't2',
    });
    expect(result[1].changedByEmail).toBeNull();
  });
});

describe('getConfigValue', () => {
  test('returns the active value for a known key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: '60' }] });
    expect(await getConfigValue('contrarian_finder_admin_history_retention_count')).toBe('60');
  });

  test('returns null for an unknown key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getConfigValue('nonexistent_key')).toBeNull();
  });
});

describe('getConfigInt', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('returns the parsed integer when a valid value is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: '30' }] });
    expect(await getConfigInt('some_key', 60)).toBe(30);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('returns the fallback and warns when no value is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getConfigInt('some_key', 60)).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has no configured value'));
  });

  test('returns the fallback and warns when the configured value is not a clean integer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'not-a-number' }] });
    expect(await getConfigInt('some_key', 60)).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('non-integer value'));
  });

  test('never throws, even on an unparseable value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: '3.5' }] });
    await expect(getConfigInt('some_key', 60)).resolves.toBe(60);
  });
});

describe('getConfigStringList', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('parses a comma-separated value, trimming each entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'user, admin ,user-contra-wokey' }] });
    expect(await getConfigStringList('some_key', ['fallback'])).toEqual(['user', 'admin', 'user-contra-wokey']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('returns the fallback and warns when no value is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getConfigStringList('some_key', ['user', 'admin'])).toEqual(['user', 'admin']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has no configured value'));
  });

  test('returns the fallback and warns when the value parses to zero real entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: ' , , ' }] });
    expect(await getConfigStringList('some_key', ['user', 'admin'])).toEqual(['user', 'admin']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has an empty value'));
  });
});
