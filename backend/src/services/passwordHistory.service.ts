// Self-Registration & Password Policy - rule 7 ("not a repeat of the last 5"). Backed by
// user_evt_password_history (migration 035).

import bcrypt from 'bcrypt';
import { pool } from '../db/pool';

const HISTORY_LIMIT = 5;

// Insert-then-prune, same shape as contrarianFinder.service.ts's admin-tier scan history:
// append the new hash, then delete anything beyond the most recent HISTORY_LIMIT rows for this
// user. Called after every successful password change/reset/registration.
export async function recordPassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    'INSERT INTO user_evt_password_history (user_id, password_hash) VALUES ($1, $2)',
    [userId, passwordHash],
  );
  await pool.query(
    `DELETE FROM user_evt_password_history
     WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM user_evt_password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
     )`,
    [userId, HISTORY_LIMIT],
  );
}

// bcrypt-compares the plaintext candidate against each of the user's last HISTORY_LIMIT stored
// hashes - true if it matches any of them (i.e. the candidate would be a reuse).
export async function isPasswordReused(userId: string, candidatePassword: string): Promise<boolean> {
  const { rows } = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM user_evt_password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, HISTORY_LIMIT],
  );
  for (const row of rows) {
    if (await bcrypt.compare(candidatePassword, row.password_hash)) return true;
  }
  return false;
}
