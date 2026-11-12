// Self-Registration & Password Policy (2026-08-29) changed signup to create accounts
// 'pending' with no role, functionally locked out until an admin assigns a role and activates
// them via Manage Users (PUT /users/:id with status + role). Scenarios that start from signup
// need that same activation to reach a real, working account instead of being stuck on
// PendingReviewPage. Same direct-Pool pattern as cleanup-user.ts/grant-role.ts.
//
// Uses the real migration-seeded 'user' role (not a throwaway E2E-only role like
// grant-role.ts's own 'e2e-permission-tester'), since the golden path needs the real
// default-user permission set (portfolio_upload:legacy - migration 024).

import { Pool } from 'pg';

export async function activateUser(email: string): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: userRows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!userRows[0]) throw new Error(`No user found with email ${email}`);
    const userId = userRows[0].id;

    const { rows: roleRows } = await pool.query<{ id: string }>("SELECT id FROM m_roles WHERE name = 'user'");
    if (!roleRows[0]) throw new Error("No 'user' role found - has migration 015 been applied?");

    await pool.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [userId, 'active']);
    // Mirrors setUserRole()'s own DELETE-then-INSERT single-role-per-user rule.
    await pool.query('DELETE FROM users_roles WHERE user_id = $1', [userId]);
    await pool.query('INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleRows[0].id]);
  } finally {
    await pool.end();
  }
}
