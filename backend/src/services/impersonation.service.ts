// "Login-as" - lets an admin-master see the app exactly as a specific user sees it, without
// their password (CLAUDE.md's "Login-as" section has the full narrative). Deliberately its own
// service, not folded into auth.service.ts - this is a distinct, higher-trust concern (issuing a
// session for someone ELSE), not ordinary login/signup.

import { pool } from '../db/pool';
import * as authService from './auth.service';
import * as rolesService from './roles.service';

export class TargetUserNotFoundError extends Error {}
export class CannotImpersonateAdminError extends Error {}

// Mirrors frontend/src/api/auth.ts's ADMIN_CONSOLE_PERMISSIONS exactly - impersonating an admin
// (or anyone holding an admin-console permission under a differently-named role) is a
// privilege-escalation path, not a support tool. Checked by permission, not a hardcoded
// roles.includes('admin')/('admin-master') check, same reasoning as everywhere else in this
// RBAC system.
const ADMIN_CONSOLE_PERMISSIONS = new Set(['roles:manage', 'permissions:manage', 'users:manage_roles', 'functions:manage']);

export async function startImpersonation(adminId: string, targetUserId: string): Promise<authService.User> {
  const target = await authService.findUserById(targetUserId);
  if (!target) throw new TargetUserNotFoundError(`No user found with id ${targetUserId}.`);

  const targetPermissions = await rolesService.getUserPermissions(targetUserId);
  if (targetPermissions.some((p) => ADMIN_CONSOLE_PERMISSIONS.has(p))) {
    throw new CannotImpersonateAdminError('Cannot impersonate a user with Admin Console access.');
  }

  await pool.query(
    'INSERT INTO user_evt_impersonation_log (admin_user_id, target_user_id) VALUES ($1, $2)',
    [adminId, targetUserId],
  );

  return target;
}

// Stamps the most recent still-open (ended_at IS NULL) log row for this admin+target pair -
// there should only ever be one, since nested impersonation is blocked at the controller level
// (a new startImpersonation can't happen while req.user.impersonatedBy is already set).
export async function endImpersonation(adminId: string, targetUserId: string): Promise<void> {
  await pool.query(
    `UPDATE user_evt_impersonation_log SET ended_at = now()
     WHERE admin_user_id = $1 AND target_user_id = $2 AND ended_at IS NULL`,
    [adminId, targetUserId],
  );
}
