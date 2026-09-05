// Account-lifecycle concerns (create/status) - kept separate from roles.service.ts, which
// stays focused on roles/permissions. Admin Console Phase 6, Architecture.md Section 3 item 6
// follow-up.

import { pool } from '../db/pool';
import * as authService from './auth.service';
import * as rolesService from './roles.service';

export type UserStatus = 'active' | 'deactivated' | 'cancelled' | 'pending';
const VALID_STATUSES: UserStatus[] = ['active', 'deactivated', 'cancelled', 'pending'];

export class InvalidStatusError extends Error {}

export function isValidUserStatus(status: string): status is UserStatus {
  return (VALID_STATUSES as string[]).includes(status);
}

// Orchestrates auth.service's createUser + roles.service's setUserRole in one place - same
// shape as auth.controller.ts's signup(), but with an admin-chosen status/role instead of
// always defaulting to active/user.
export async function createUserAccount(input: {
  email: string; password: string; status: UserStatus; role: string;
}): Promise<{ id: string; email: string; status: UserStatus; roles: string[] }> {
  const passwordHash = await authService.hashPassword(input.password);
  const user = await authService.createUser(input.email, passwordHash, input.status);
  await rolesService.setUserRole(user.id, input.role);
  const roles = await rolesService.getUserRoles(user.id);
  return { id: user.id, email: user.email, status: input.status, roles };
}

export async function updateUserStatus(userId: string, status: string): Promise<void> {
  if (!isValidUserStatus(status)) throw new InvalidStatusError(`Unknown status: ${status}`);
  await pool.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [userId, status]);
}

const UNIQUE_VIOLATION = '23505';

// Manage Users (Phase 7 - edit-then-save). Reuses auth.service's EmailAlreadyExistsError
// rather than a duplicate type, so callers only ever need to check one error class for "this
// email is taken," whether it happened at signup, admin-create, or here.
export async function updateUserEmail(userId: string, email: string): Promise<void> {
  try {
    await pool.query('UPDATE users SET email = $2, updated_at = now() WHERE id = $1', [userId, email]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new authService.EmailAlreadyExistsError('An account with this email already exists.');
    }
    throw err;
  }
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, passwordHash]);
}

// Re-read after a partial update (users.controller.ts's updateUser) so the response always
// reflects the row's actual current state, regardless of which fields were changed.
export async function getUserDetail(userId: string): Promise<{ id: string; email: string; status: string } | null> {
  const { rows } = await pool.query<{ id: string; email: string; status: string }>(
    'SELECT id, email, status FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] ?? null;
}
