// Functional Authorization (RBAC), Architecture.md Section 3 item 6. Backed by
// m_roles/users_roles/m_role_permissions (migration 015). The schema supports
// many-to-many (a user could have multiple roles), but setUserRole() enforces
// a single-role-per-user business rule for now — it replaces, not appends.

import { pool } from '../db/pool';

export class InvalidRoleError extends Error {}
export class DuplicateRoleError extends Error {}
export class RoleInUseError extends Error {}
export class MissingParentPermissionError extends Error {}
export class ParentPermissionInUseError extends Error {}
export class RoleNotAllowedForPermissionError extends Error {}

// Some permissions only make sense as an add-on to another - e.g.
// contrarian_finder:scan_history only affects behavior that's itself gated
// by contrarian_finder:scan (see contrarianFinder.controller.ts's
// saveLastScan, which resolves the retention tier only after the scan
// permission has already let the request through). Granting the child alone
// would be a silent no-op via the Manage Permission screen, so grant/revoke
// below enforce the dependency both ways: a child can't be granted without
// its parent, and a parent can't be revoked while a granted child depends on
// it. Flat map (not a general dependency graph) since this is currently the
// only such pair - extend by adding another entry if a second case shows up.
const PERMISSION_REQUIRES: Record<string, string> = {
  'contrarian_finder:scan_history': 'contrarian_finder:scan',
};

// Config Properties (2026-08-24) is system-level configuration - the user's own call was that
// config_properties:manage must never be grantable to any role except admin-master, even by an
// admin using the Manage Role screen. This is a deliberate, narrow exception to "every gate in
// this app is DB-driven, never a hardcoded role-name check": the permission mechanism itself
// stays fully DB-backed (still a real, revocable m_role_permissions row, still checked by
// requirePermission like everything else) - only *which roles this one specific key can be
// granted to* is hardcoded. Small explicit set, not a general per-permission role-allowlist
// system, since this is currently the only such case.
const ADMIN_MASTER_ONLY_PERMISSIONS = new Set(['config_properties:manage', 'users:impersonate']);

export interface Role {
  id: string;
  name: string;
  userCount: number;
}

export interface UserWithRoles {
  id: string;
  email: string;
  roles: string[];
  apiKeyProviders: string[];
  status: string;
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT r.name FROM users_roles ur JOIN m_roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.name);
}

// GET /auth/me (Admin Console Phase 8) - the frontend's real permission-based UI gates
// (Contrarian Finder's Run Scan, own API Keys visibility) check against this instead of
// hardcoding roles.includes('admin'), since a differently-named role could be granted either
// permission without being called "admin". Same join shape as requirePermission.ts's own
// query, just returning every granted key instead of checking one.
export async function getUserPermissions(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ permission_key: string }>(
    `SELECT DISTINCT rp.permission_key
     FROM users_roles ur
     JOIN m_role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.permission_key);
}

// Transactional: without this, a failed INSERT after the DELETE would leave
// the user with zero roles until the next successful call.
export async function setUserRole(userId: string, roleName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: string }>('SELECT id FROM m_roles WHERE name = $1', [roleName]);
    if (!rows[0]) throw new InvalidRoleError(`Unknown role: ${roleName}`);
    const roleId = rows[0].id;

    await client.query('DELETE FROM users_roles WHERE user_id = $1', [userId]);
    await client.query('INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

const UNIQUE_VIOLATION = '23505';

// View/Create Role (Admin Console Phase 3) + Manage Role (Phase 7 - Delete). userCount lets
// the frontend disable/explain the Delete button, though deleteRole below is the real guard.
export async function listRoles(): Promise<Role[]> {
  const { rows } = await pool.query<{ id: string; name: string; user_count: string }>(
    `SELECT r.id, r.name, COUNT(ur.user_id)::int AS user_count
     FROM m_roles r
     LEFT JOIN users_roles ur ON ur.role_id = r.id
     GROUP BY r.id, r.name
     ORDER BY r.name`,
  );
  // node-pg returns INT8/COUNT columns as strings (CockroachDB's ::int is a 64-bit INT8, not
  // a true 32-bit int4, so pg's default type parser stringifies it to avoid precision loss on
  // large values) - Number() here is what actually makes Role.userCount a real number, found
  // live: {role.userCount === 1} silently never matched for a role with exactly one user.
  return rows.map((r) => ({ id: r.id, name: r.name, userCount: Number(r.user_count) }));
}

export async function createRole(name: string): Promise<Role> {
  try {
    const { rows } = await pool.query<{ id: string; name: string }>(
      'INSERT INTO m_roles (name) VALUES ($1) RETURNING id, name',
      [name],
    );
    return { ...rows[0], userCount: 0 };
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicateRoleError(`A role named "${name}" already exists.`);
    }
    throw err;
  }
}

// Manage Role (Phase 7) - a role can only be deleted while no user holds it. Cascades to
// m_role_permissions automatically (ON DELETE CASCADE, migration 015) - no extra cleanup.
export async function deleteRole(roleId: string): Promise<void> {
  const { rows } = await pool.query('SELECT 1 FROM users_roles WHERE role_id = $1 LIMIT 1', [roleId]);
  if (rows[0]) throw new RoleInUseError('Cannot delete a role that is still assigned to a user.');
  await pool.query('DELETE FROM m_roles WHERE id = $1', [roleId]);
}

// View/Edit Permission (Admin Console Phase 3) - per-role grant list + toggle. The FK from
// m_role_permissions.permission_key to m_function_master (migration 016) guarantees grant/
// revoke can never reference a key that isn't a real registered function.
export async function listRolePermissions(roleId: string): Promise<string[]> {
  const { rows } = await pool.query<{ permission_key: string }>(
    'SELECT permission_key FROM m_role_permissions WHERE role_id = $1 ORDER BY permission_key',
    [roleId],
  );
  return rows.map((r) => r.permission_key);
}

export async function grantPermission(roleId: string, permissionKey: string): Promise<void> {
  if (ADMIN_MASTER_ONLY_PERMISSIONS.has(permissionKey)) {
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM m_roles WHERE id = $1', [roleId]);
    if (rows[0]?.name !== 'admin-master') {
      throw new RoleNotAllowedForPermissionError(`"${permissionKey}" can only be granted to the admin-master role.`);
    }
  }

  const requiredParent = PERMISSION_REQUIRES[permissionKey];
  if (requiredParent) {
    const { rows } = await pool.query(
      'SELECT 1 FROM m_role_permissions WHERE role_id = $1 AND permission_key = $2 LIMIT 1',
      [roleId, requiredParent],
    );
    if (!rows[0]) {
      throw new MissingParentPermissionError(
        `"${permissionKey}" requires "${requiredParent}" to already be granted to this role.`,
      );
    }
  }

  await pool.query(
    'INSERT INTO m_role_permissions (role_id, permission_key) VALUES ($1, $2) ON CONFLICT (role_id, permission_key) DO NOTHING',
    [roleId, permissionKey],
  );
}

export async function revokePermission(roleId: string, permissionKey: string): Promise<void> {
  const dependentChildren = Object.entries(PERMISSION_REQUIRES)
    .filter(([, parent]) => parent === permissionKey)
    .map(([child]) => child);

  if (dependentChildren.length > 0) {
    const { rows } = await pool.query<{ permission_key: string }>(
      'SELECT permission_key FROM m_role_permissions WHERE role_id = $1 AND permission_key = ANY($2)',
      [roleId, dependentChildren],
    );
    if (rows[0]) {
      throw new ParentPermissionInUseError(
        `Cannot revoke "${permissionKey}" while this role still has "${rows[0].permission_key}", which requires it — revoke that first.`,
      );
    }
  }

  await pool.query(
    'DELETE FROM m_role_permissions WHERE role_id = $1 AND permission_key = $2',
    [roleId, permissionKey],
  );
}

// View/Edit User Role (Admin Console Phase 2) - backs GET /users. Single-role-per-user is
// enforced by setUserRole above, but this returns an array to match getUserRoles' shape
// rather than assuming that invariant here too. Also surfaces which FMP/Finnhub keys each
// user has on file (never the key itself, just the provider name - same "existence, not
// value" boundary users_subscriptions already enforces everywhere else) - answers "whose API
// key is whose" from the admin's user list instead of needing a separate screen.
export async function listUsersWithRoles(): Promise<UserWithRoles[]> {
  const { rows } = await pool.query<{ id: string; email: string; status: string; role_name: string | null; provider: string | null }>(
    `SELECT u.id, u.email, u.status, r.name AS role_name, s.provider
     FROM users u
     LEFT JOIN users_roles ur ON ur.user_id = u.id
     LEFT JOIN m_roles r ON r.id = ur.role_id
     LEFT JOIN users_subscriptions s ON s.user_id = u.id
     ORDER BY u.email`,
  );
  const byId = new Map<string, UserWithRoles>();
  for (const row of rows) {
    let entry = byId.get(row.id);
    if (!entry) {
      entry = { id: row.id, email: row.email, roles: [], apiKeyProviders: [], status: row.status };
      byId.set(row.id, entry);
    }
    if (row.role_name && !entry.roles.includes(row.role_name)) entry.roles.push(row.role_name);
    if (row.provider && !entry.apiKeyProviders.includes(row.provider)) entry.apiKeyProviders.push(row.provider);
  }
  return [...byId.values()];
}
