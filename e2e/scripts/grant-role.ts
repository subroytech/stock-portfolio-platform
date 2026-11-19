// Grants a throwaway E2E test user a specific permission, via a dedicated
// E2E-only role - not the dev database's manually-created "user-contra-*"
// roles (those exist only as runtime rows created through the Admin UI, not
// via any migration, so they aren't present in the separate E2E test
// database). Self-contained: creates the role and grants the permission if
// they don't already exist, rather than depending on dev-specific setup
// that this test database was never seeded with.
//
// Same direct-Pool pattern as cleanup-user.ts. Mirrors roles.service.ts's
// setUserRole() single-role-per-user business rule (DELETE then INSERT).

import { Pool } from 'pg';

export async function grantPermission(email: string, roleName: string, permissionKey: string): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: userRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!userRows[0]) throw new Error(`No user found with email ${email}`);

    const { rows: roleRows } = await pool.query<{ id: string }>(
      `INSERT INTO m_roles (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = excluded.name
       RETURNING id`,
      [roleName],
    );
    const roleId = roleRows[0].id;

    // permission_key FKs to m_function_master (migration 016) - api_keys:manage_own
    // is already seeded there by migration 018, so this insert won't violate that FK.
    await pool.query(
      `INSERT INTO m_role_permissions (role_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [roleId, permissionKey],
    );

    await pool.query('DELETE FROM users_roles WHERE user_id = $1', [userRows[0].id]);
    await pool.query('INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)', [userRows[0].id, roleId]);
  } finally {
    await pool.end();
  }
}
