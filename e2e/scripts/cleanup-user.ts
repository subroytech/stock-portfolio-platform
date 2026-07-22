// Deletes a throwaway E2E test user by email. Every portfolio-scoped table
// cascades from users (ON DELETE CASCADE via migrations 002-005, 012, 013),
// so this single DELETE removes the user's portfolios, holdings, cash
// positions, uploads, action history, and any stored API-key subscription.

import { Pool } from 'pg';

export async function cleanupUser(email: string): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  } finally {
    await pool.end();
  }
}
