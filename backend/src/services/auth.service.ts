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
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtSecret) as TokenPayload;
}

export interface User {
  id: string;
  email: string;
}

export interface UserWithHash extends User {
  passwordHash: string;
  status: string;
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
// status defaults to 'active' for the public signup path (auth.controller.ts's signup() calls
// this with no third arg) - only the admin-only create-user path (users.service.ts's
// createUserAccount) ever passes something else.
export async function createUser(email: string, passwordHash: string, status: string = 'active'): Promise<User> {
  try {
    const { rows } = await pool.query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash, status) VALUES ($1, $2, $3) RETURNING id, email',
      [email, passwordHash, status],
    );
    return rows[0];
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new EmailAlreadyExistsError('An account with this email already exists.');
    }
    throw err;
  }
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<{ id: string; email: string; password_hash: string; status: string }>(
    'SELECT id, email, password_hash, status FROM users WHERE email = $1',
    [email],
  );
  if (!rows[0]) return null;
  const { id, email: rowEmail, password_hash: passwordHash, status } = rows[0];
  return { id, email: rowEmail, passwordHash, status };
}

// For GET /auth/me (req.user only has the id from the JWT, never the email).
export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

// Same InvalidCredentialsError/message whether the email doesn't exist or the
// password is wrong — deliberately centralized here (not left to the
// controller) so this user-enumeration protection can't be accidentally
// bypassed by a future call site handling the two cases differently.
export async function login(email: string, password: string): Promise<User> {
  const user = await findUserByEmail(email);
  if (!user) throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  // Checked last, only once the password is already confirmed correct - a wrong password
  // against a non-active account gets the exact same rejection as a wrong password against
  // an active one, so status is never distinguishable from a credentials guess.
  if (user.status !== 'active') throw new InvalidCredentialsError(LOGIN_ERROR_MESSAGE);
  return { id: user.id, email: user.email };
}
