// Roll-your-own auth: bcrypt password hashing + JWT session tokens, decided
// 2026-07-11 (see Architecture.md Section 2 / the "auth decision" plan) —
// the users table already had password_hash provisioned from Phase 1 schema
// design, and bcrypt/jsonwebtoken were already installed dependencies from
// Phase 0 scaffolding, unused until now.

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import env from '../config/env';

export class EmailAlreadyExistsError extends Error {}
export class InvalidCredentialsError extends Error {}

// Shared by auth.controller.ts (sets/clears) and requireAuth.ts (reads) so the
// name can't drift between the two.
export const AUTH_COOKIE_NAME = 'auth_token';

const BCRYPT_ROUNDS = 12;
const UNIQUE_VIOLATION = '23505';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  userId: string;
  // Present only during a "Login-as" impersonation session (backend/src/services/
  // impersonation.service.ts) - the admin's own user id, so the session can always find its
  // way back without a second cookie/session-store. Absent on every normal login.
  impersonatedBy?: string;
}

export function signToken(userId: string, options?: { impersonatedBy?: string; expiresIn?: string }): string {
  const payload: TokenPayload = options?.impersonatedBy ? { userId, impersonatedBy: options.impersonatedBy } : { userId };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: options?.expiresIn ?? env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtSecret) as TokenPayload;
}

// Self-Registration & Password Policy - Forgot Password's two-step token handoff. A "challenge"
// token proves "this browser was just shown these exact question ids for this user"; a "reset"
// token proves "this browser just answered all of them correctly." Separate payload shapes
// (via `purpose`) so a challenge token can never be replayed as a reset token or vice versa -
// stateless, no DB table, same short-lived-signed-token pattern already used for Login-as.
interface PasswordResetChallengePayload {
  purpose: 'password-reset-challenge';
  userId: string;
  questionIds: string[];
}
interface PasswordResetPayload {
  purpose: 'password-reset';
  userId: string;
}

export function signPasswordResetChallengeToken(userId: string, questionIds: string[]): string {
  const payload: PasswordResetChallengePayload = { purpose: 'password-reset-challenge', userId, questionIds };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.passwordResetExpiresIn } as jwt.SignOptions);
}

export function verifyPasswordResetChallengeToken(token: string): PasswordResetChallengePayload {
  const payload = jwt.verify(token, env.jwtSecret) as Partial<PasswordResetChallengePayload>;
  if (payload.purpose !== 'password-reset-challenge') throw new Error('Invalid token purpose.');
  return payload as PasswordResetChallengePayload;
}

export function signPasswordResetToken(userId: string): string {
  const payload: PasswordResetPayload = { purpose: 'password-reset', userId };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.passwordResetExpiresIn } as jwt.SignOptions);
}

export function verifyPasswordResetToken(token: string): PasswordResetPayload {
  const payload = jwt.verify(token, env.jwtSecret) as Partial<PasswordResetPayload>;
  if (payload.purpose !== 'password-reset') throw new Error('Invalid token purpose.');
  return payload as PasswordResetPayload;
}

export interface User {
  id: string;
  email: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
}

export interface UserWithHash extends User {
  passwordHash: string;
}

// Shared across every login-rejection path (unknown email, wrong password, non-active status)
// so they stay textually identical - a single constant is what actually guarantees that, not
// three separately-typed copies of the same literal. Deliberately does not distinguish *why*
// login failed (anti-enumeration), confirmed with the user 2026-08-01.
const LOGIN_ERROR_MESSAGE = 'Invalid email or password combination, or no account exists.';

// Race-condition backstop: the controller checks for an existing email first,
// but a concurrent signup for the same address could still slip past that
// check before this INSERT runs — the DB's own UNIQUE constraint is the real
// guarantee, this just turns its violation into the same typed error the
// controller already expects from the pre-check.
// status defaults to 'active' for the admin-created path (users.service.ts's createUserAccount
// always passes one explicitly). Self-registration (auth.controller.ts's signup()) passes
// 'pending' - see Self-Registration & Password Policy. firstName/lastName are optional
// (admin-created accounts don't collect them - see migration 033's own note).
export async function createUser(
  email: string, passwordHash: string, status: string = 'active',
  firstName: string | null = null, lastName: string | null = null,
): Promise<User> {
  try {
    const { rows } = await pool.query<{ id: string; email: string; status: string; first_name: string | null; last_name: string | null }>(
      `INSERT INTO users (email, password_hash, status, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, status, first_name, last_name`,
      [email, passwordHash, status, firstName, lastName],
    );
    return mapUserRow(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new EmailAlreadyExistsError('An account with this email already exists.');
    }
    throw err;
  }
}

function mapUserRow(row: { id: string; email: string; status: string; first_name: string | null; last_name: string | null }): User {
  return { id: row.id, email: row.email, status: row.status, firstName: row.first_name, lastName: row.last_name };
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<{ id: string; email: string; password_hash: string; status: string; first_name: string | null; last_name: string | null }>(
    'SELECT id, email, password_hash, status, first_name, last_name FROM users WHERE email = $1',
    [email],
  );
  if (!rows[0]) return null;
  return { ...mapUserRow(rows[0]), passwordHash: rows[0].password_hash };
}

// For GET /auth/me (req.user only has the id from the JWT, never the email).
export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<{ id: string; email: string; status: string; first_name: string | null; last_name: string | null }>(
    'SELECT id, email, status, first_name, last_name FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ? mapUserRow(rows[0]) : null;
}

// Self-Registration & Password Policy - Change Password needs the current hash to verify
// against, but only has the caller's own id (from req.user, never the email) to work with.
// (Writing a new hash reuses users.service.ts's existing updateUserPassword() - no need to
// duplicate that here.)
export async function getPasswordHashById(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [id]);
  return rows[0]?.password_hash ?? null;
}

// Same InvalidCredentialsError/message whether the email doesn't exist or the
// password is wrong — deliberately centralized here (not left to the
// controller) so this user-enumeration protection can't be accidentally
// bypassed by a future call site handling the two cases differently.
// Self-Registration & Password Policy: 'pending' accounts (self-registered, awaiting an admin
// to assign a role and activate them) are deliberately allowed to log in - they just see the
// "under review" banner and nothing else (frontend gate, ProtectedRoute.tsx). Only
// 'deactivated'/'cancelled' still block login outright, exactly as before.
const LOGIN_BLOCKED_STATUSES = ['deactivated', 'cancelled'];

export async function login(email: string, password: string): Promise<User> {
  const user = await findUserByEmail(email);
  if (!user) throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  // Checked last, only once the password is already confirmed correct - a wrong password
  // against a blocked account gets the exact same rejection as a wrong password against an
  // active one, so status is never distinguishable from a credentials guess.
  if (LOGIN_BLOCKED_STATUSES.includes(user.status)) throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  return { id: user.id, email: user.email, status: user.status, firstName: user.firstName, lastName: user.lastName };
}
