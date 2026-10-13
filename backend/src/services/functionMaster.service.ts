// m_function_master (migration 016) - catalogs only the app "functions" that are genuine
// exceptions to the default "any signed-in user can use it" rule (Admin Console, Architecture.md
// Section 3 item 6 follow-up). Feeds the "View/Edit Permission" fixed-dropdown picker and the
// "View/Manage Functions" admin screen.

import { pool } from '../db/pool';

export type FunctionStatus = 'active' | 'inactive' | 'Dev-WIP' | 'QA-Test';
const VALID_STATUSES: FunctionStatus[] = ['active', 'inactive', 'Dev-WIP', 'QA-Test'];

export class InvalidStatusError extends Error {}
export class DuplicateFunctionError extends Error {}

export interface FunctionMasterRow {
  id: string;
  permissionKey: string;
  name: string;
  description: string | null;
  status: FunctionStatus;
}

function toRow(row: {
  id: string; permission_key: string; name: string; description: string | null; status: string;
}): FunctionMasterRow {
  return {
    id: row.id,
    permissionKey: row.permission_key,
    name: row.name,
    description: row.description,
    status: row.status as FunctionStatus,
  };
}

export function isValidStatus(status: string): status is FunctionStatus {
  return (VALID_STATUSES as string[]).includes(status);
}

// activeOnly filters to 'active'+'QA-Test' - the permission-picker's contract (Dev-WIP/
// inactive hidden since granting those wouldn't do anything yet). The "View/Manage Functions"
// screen itself calls this with activeOnly: false to see every row regardless of status.
export async function listFunctions({ activeOnly }: { activeOnly: boolean }): Promise<FunctionMasterRow[]> {
  const { rows } = activeOnly
    ? await pool.query(
        `SELECT id, permission_key, name, description, status FROM m_function_master
         WHERE status IN ('active', 'QA-Test') ORDER BY name`,
      )
    : await pool.query('SELECT id, permission_key, name, description, status FROM m_function_master ORDER BY name');
  return rows.map(toRow);
}

const UNIQUE_VIOLATION = '23505';

export async function createFunction(input: {
  permissionKey: string; name: string; description: string | null; status: string;
}): Promise<FunctionMasterRow> {
  if (!isValidStatus(input.status)) throw new InvalidStatusError(`Unknown status: ${input.status}`);
  try {
    const { rows } = await pool.query(
      `INSERT INTO m_function_master (permission_key, name, description, status)
       VALUES ($1, $2, $3, $4) RETURNING id, permission_key, name, description, status`,
      [input.permissionKey, input.name, input.description, input.status],
    );
    return toRow(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicateFunctionError(`A function with permission_key "${input.permissionKey}" already exists.`);
    }
    throw err;
  }
}

// Status-only edit - permission_key/name intentionally can't be changed after creation
// (permission_key is tied to a real requirePermission(key) call in code; renaming it here
// would silently break that route's gating without anyone touching the route itself).
export async function updateFunctionStatus(id: string, status: string): Promise<FunctionMasterRow | null> {
  if (!isValidStatus(status)) throw new InvalidStatusError(`Unknown status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE m_function_master SET status = $2, updated_at = now()
     WHERE id = $1 RETURNING id, permission_key, name, description, status`,
    [id, status],
  );
  return rows[0] ? toRow(rows[0]) : null;
}
