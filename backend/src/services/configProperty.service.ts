// Config Properties framework (2026-08-24) - m_config_group/m_config_property/
// m_config_property_value (migration 027). General-purpose, admin-configurable settings so
// business-tunable values (e.g. contrarianFinder.service.ts's admin-tier scan history
// retention count) live in the DB instead of hardcoded constants, editable by admin-master
// alone without a code deploy. Distinct from m_function_master/functionMaster.service.ts,
// which is an unrelated RBAC permission catalog - do not conflate the two.
//
// Values are never overwritten: every change inserts a new m_config_property_value row
// (version, effective_timestamp, is_active) and flips the previous active row's is_active to
// false, all in one transaction - same "transactional flip" shape as roles.service.ts's
// setUserRole() and contrarianFinder.service.ts's saveLastScan() user-tier branch.
// effective_timestamp always equals created_at for now (no real scheduling logic yet - see
// the migration's own comment); the column exists so that can be added later with zero schema
// change.
//
// Reads are always live (getConfigValue/getConfigInt) - no caching. Values change rarely
// (admin-only) and the one consumer wired up so far (saveLastScan) only runs once per
// completed scan, not a hot path - see Architecture.md/CLAUDE.md's Config Properties section
// for the fuller reasoning the user and Claude worked through before building this.

import { pool } from '../db/pool';

export type ConfigValueType = 'integer' | 'string';
const VALID_VALUE_TYPES: ConfigValueType[] = ['integer', 'string'];

export function isValidValueType(type: string): type is ConfigValueType {
  return (VALID_VALUE_TYPES as string[]).includes(type);
}

export class InvalidValueTypeError extends Error {}
export class InvalidConfigValueError extends Error {}
export class DuplicateConfigGroupError extends Error {}
export class DuplicatePropertyKeyError extends Error {}

const UNIQUE_VIOLATION = '23505';

export interface ConfigGroup {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigPropertyRow {
  id: string;
  groupId: string;
  groupName: string;
  propertyKey: string;
  name: string;
  description: string | null;
  valueType: ConfigValueType;
  minValue: string | null;
  maxValue: string | null;
  status: string;
  currentValue: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigPropertyValueRow {
  id: string;
  propertyId: string;
  value: string;
  version: number;
  effectiveTimestamp: string;
  isActive: boolean;
  changedBy: string | null;
  changedByEmail: string | null;
  createdAt: string;
}

// value/min/max are always compared as plain strings for 'string' type (range is meaningless
// there - ignored even if populated, per the user's own call: range only applies when
// numeric). For 'integer', the value must be a clean base-10 integer string and, if min/max
// are set, fall within [min, max] inclusive.
function validateValue(valueType: ConfigValueType, value: string, minValue: string | null, maxValue: string | null): void {
  if (valueType === 'string') {
    if (!value.trim()) throw new InvalidConfigValueError('Value cannot be empty.');
    return;
  }

  if (!/^-?\d+$/.test(value.trim())) {
    throw new InvalidConfigValueError(`"${value}" is not a valid integer.`);
  }
  const num = Number(value.trim());
  if (minValue !== null && num < Number(minValue)) {
    throw new InvalidConfigValueError(`${num} is below the minimum allowed value of ${minValue}.`);
  }
  if (maxValue !== null && num > Number(maxValue)) {
    throw new InvalidConfigValueError(`${num} is above the maximum allowed value of ${maxValue}.`);
  }
}

function toGroup(row: { id: string; name: string; description: string | null; created_at: string; updated_at: string }): ConfigGroup {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listGroups(): Promise<ConfigGroup[]> {
  const { rows } = await pool.query(
    'SELECT id, name, description, created_at, updated_at FROM m_config_group ORDER BY name',
  );
  return rows.map(toGroup);
}

export async function createGroup(input: { name: string; description: string | null }): Promise<ConfigGroup> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO m_config_group (name, description) VALUES ($1, $2)
       RETURNING id, name, description, created_at, updated_at`,
      [input.name, input.description],
    );
    return toGroup(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicateConfigGroupError(`A config group named "${input.name}" already exists.`);
    }
    throw err;
  }
}

export async function updateGroup(id: string, input: { name: string; description: string | null }): Promise<ConfigGroup | null> {
  try {
    const { rows } = await pool.query(
      `UPDATE m_config_group SET name = $2, description = $3, updated_at = now()
       WHERE id = $1 RETURNING id, name, description, created_at, updated_at`,
      [id, input.name, input.description],
    );
    return rows[0] ? toGroup(rows[0]) : null;
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicateConfigGroupError(`A config group named "${input.name}" already exists.`);
    }
    throw err;
  }
}

const PROPERTY_SELECT = `
  SELECT p.id, p.group_id, g.name AS group_name, p.property_key, p.name, p.description,
         p.value_type, p.min_value, p.max_value, p.status, p.created_at, p.updated_at,
         v.value AS current_value, v.version AS current_version
  FROM m_config_property p
  JOIN m_config_group g ON g.id = p.group_id
  JOIN m_config_property_value v ON v.property_id = p.id AND v.is_active = true
`;

function toPropertyRow(row: {
  id: string; group_id: string; group_name: string; property_key: string; name: string; description: string | null;
  value_type: string; min_value: string | null; max_value: string | null; status: string;
  created_at: string; updated_at: string; current_value: string; current_version: string | number;
}): ConfigPropertyRow {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    propertyKey: row.property_key,
    name: row.name,
    description: row.description,
    valueType: row.value_type as ConfigValueType,
    minValue: row.min_value,
    maxValue: row.max_value,
    status: row.status,
    currentValue: row.current_value,
    currentVersion: Number(row.current_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProperties(opts: { groupId?: string } = {}): Promise<ConfigPropertyRow[]> {
  if (opts.groupId) {
    const { rows } = await pool.query(`${PROPERTY_SELECT} WHERE p.group_id = $1 ORDER BY p.name`, [opts.groupId]);
    return rows.map(toPropertyRow);
  }
  const { rows } = await pool.query(`${PROPERTY_SELECT} ORDER BY g.name, p.name`);
  return rows.map(toPropertyRow);
}

export async function getProperty(id: string): Promise<ConfigPropertyRow | null> {
  const { rows } = await pool.query(`${PROPERTY_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? toPropertyRow(rows[0]) : null;
}

// Creates the property definition and its initial value (version 1) in one transaction - a
// property can never exist with zero value rows, so every read path (getConfigValue et al.)
// can assume "found or not found," never "definition exists, no value yet."
export async function createProperty(input: {
  groupId: string;
  propertyKey: string;
  name: string;
  description: string | null;
  valueType: string;
  minValue: string | null;
  maxValue: string | null;
  status: string;
  initialValue: string;
  changedBy: string;
}): Promise<ConfigPropertyRow> {
  if (!isValidValueType(input.valueType)) {
    throw new InvalidValueTypeError(`Unknown value_type: ${input.valueType}`);
  }
  validateValue(input.valueType, input.initialValue, input.minValue, input.maxValue);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let propertyId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [input.groupId, input.propertyKey, input.name, input.description, input.valueType, input.minValue, input.maxValue, input.status],
      );
      propertyId = rows[0].id;
    } catch (err) {
      if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
        throw new DuplicatePropertyKeyError(`A property with key "${input.propertyKey}" already exists.`);
      }
      throw err;
    }

    await client.query(
      `INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
       VALUES ($1, $2, 1, true, $3)`,
      [propertyId, input.initialValue, input.changedBy],
    );

    await client.query('COMMIT');

    const created = await getProperty(propertyId);
    return created!;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Metadata-only edit - propertyKey/valueType are immutable after creation (same reasoning as
// m_function_master.permission_key: real code references property_key directly, and changing
// valueType retroactively would invalidate already-stored history's semantics).
export async function updatePropertyMetadata(id: string, input: {
  name: string; description: string | null; minValue: string | null; maxValue: string | null; status: string;
}): Promise<ConfigPropertyRow | null> {
  const { rowCount } = await pool.query(
    `UPDATE m_config_property SET name = $2, description = $3, min_value = $4, max_value = $5, status = $6, updated_at = now()
     WHERE id = $1`,
    [id, input.name, input.description, input.minValue, input.maxValue, input.status],
  );
  if (!rowCount) return null;
  return getProperty(id);
}

// Config properties whose value is a comma-separated list of role names, validated against the
// live m_roles table at write time so a typo can never become a silent, hard-to-debug no-op.
// A deliberate, narrow exception scoped to these specific keys - not a new generic
// validation-type mechanism, mirroring roles.service.ts's ADMIN_MASTER_ONLY_PERMISSIONS (a
// small hardcoded set for one specific case, not a general framework built for it).
const ROLE_LIST_PROPERTY_KEYS = new Set(['api_key_fallback_eligible_roles']);

async function validateRoleListValue(value: string): Promise<void> {
  const names = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (!names.length) throw new InvalidConfigValueError('At least one role name is required.');
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM m_roles WHERE name = ANY($1)', [names]);
  const found = new Set(rows.map((r) => r.name));
  const unknown = names.filter((n) => !found.has(n));
  if (unknown.length) throw new InvalidConfigValueError(`Unknown role name(s): ${unknown.join(', ')}.`);
}

// The versioned write - validates against the property's own declared type/range, then flips
// the current active value row to inactive and inserts the new one as active, in one
// transaction. Exact "transactional flip" shape as roles.service.ts's setUserRole().
export async function setPropertyValue(propertyId: string, input: { value: string; changedBy: string }): Promise<ConfigPropertyValueRow | null> {
  const { rows: propRows } = await pool.query<{ property_key: string; value_type: string; min_value: string | null; max_value: string | null }>(
    'SELECT property_key, value_type, min_value, max_value FROM m_config_property WHERE id = $1',
    [propertyId],
  );
  const prop = propRows[0];
  if (!prop) return null;
  validateValue(prop.value_type as ConfigValueType, input.value, prop.min_value, prop.max_value);
  if (ROLE_LIST_PROPERTY_KEYS.has(prop.property_key)) await validateRoleListValue(input.value);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: versionRows } = await client.query<{ next_version: string }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM m_config_property_value WHERE property_id = $1',
      [propertyId],
    );
    const nextVersion = Number(versionRows[0].next_version);

    await client.query(
      'UPDATE m_config_property_value SET is_active = false WHERE property_id = $1 AND is_active = true',
      [propertyId],
    );

    const { rows } = await client.query(
      `INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, property_id, value, version, effective_timestamp, is_active, changed_by, created_at`,
      [propertyId, input.value, nextVersion, input.changedBy],
    );

    await client.query('COMMIT');

    const row = rows[0];
    return {
      id: row.id,
      propertyId: row.property_id,
      value: row.value,
      version: Number(row.version),
      effectiveTimestamp: row.effective_timestamp,
      isActive: row.is_active,
      changedBy: row.changed_by,
      changedByEmail: null,
      createdAt: row.created_at,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

export async function listPropertyValueHistory(propertyId: string): Promise<ConfigPropertyValueRow[]> {
  const { rows } = await pool.query(
    `SELECT v.id, v.property_id, v.value, v.version, v.effective_timestamp, v.is_active, v.changed_by, v.created_at,
            u.email AS changed_by_email
     FROM m_config_property_value v
     LEFT JOIN users u ON u.id = v.changed_by
     WHERE v.property_id = $1
     ORDER BY v.version DESC`,
    [propertyId],
  );
  return rows.map((row) => ({
    id: row.id,
    propertyId: row.property_id,
    value: row.value,
    version: Number(row.version),
    effectiveTimestamp: row.effective_timestamp,
    isActive: row.is_active,
    changedBy: row.changed_by,
    changedByEmail: row.changed_by_email,
    createdAt: row.created_at,
  }));
}

// The live, no-cache read path real consumers use - every call queries the DB directly (no
// in-memory cache), a deliberate choice: values change rarely (admin-master only) and the
// consumers wired up so far aren't on a hot path. Add caching later only if a specific future
// property genuinely needs it.
export async function getConfigValue(propertyKey: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT v.value
     FROM m_config_property_value v
     JOIN m_config_property p ON v.property_id = p.id
     WHERE p.property_key = $1 AND v.is_active = true
     LIMIT 1`,
    [propertyKey],
  );
  return rows[0]?.value ?? null;
}

// Defensive integer read for business-critical limits (e.g. contrarianFinder.service.ts's
// admin-tier retention count) - never throws. A missing row or an unparseable value logs a
// warning and returns the caller's own fallback, rather than letting a misconfigured/missing
// config row silently become 0/NaN/undefined and cause runaway growth or an accidental wipe.
export async function getConfigInt(propertyKey: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(propertyKey);
  if (raw === null) {
    console.warn(`[configProperty] "${propertyKey}" has no configured value - using fallback ${fallback}.`);
    return fallback;
  }
  if (!/^-?\d+$/.test(raw.trim()) || !Number.isInteger(Number(raw))) {
    console.warn(`[configProperty] "${propertyKey}" has a non-integer value "${raw}" - using fallback ${fallback}.`);
    return fallback;
  }
  return Number(raw);
}

// Defensive comma-separated-list read (e.g. userSubscription.service.ts's API key fallback
// eligible roles) - never throws, same defensive contract as getConfigInt. A missing row or a
// value that parses to zero real entries logs a warning and returns the caller's own fallback.
export async function getConfigStringList(propertyKey: string, fallback: string[]): Promise<string[]> {
  const raw = await getConfigValue(propertyKey);
  if (raw === null) {
    console.warn(`[configProperty] "${propertyKey}" has no configured value - using fallback [${fallback.join(', ')}].`);
    return fallback;
  }
  const list = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (!list.length) {
    console.warn(`[configProperty] "${propertyKey}" has an empty value - using fallback [${fallback.join(', ')}].`);
    return fallback;
  }
  return list;
}
