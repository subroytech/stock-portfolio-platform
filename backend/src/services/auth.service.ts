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
}

// Race-condition backstop: the controller checks for an existing email first,
// but a concurrent signup for the same address could still slip past that
// check before this INSERT runs — the DB's own UNIQUE constraint is the real
// guarantee, this just turns its violation into the same typed error the
// controller already expects from the pre-check.
export async function createUser(email: string, passwordHash: string): Promise<User> {
  try {
    const { rows } = await pool.query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash],
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
  const { rows } = await pool.query<{ id: string; email: string; password_hash: string }>(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email],
  );
  if (!rows[0]) return null;
  const { id, email: rowEmail, password_hash: passwordHash } = rows[0];
  return { id, email: rowEmail, passwordHash };
}

// Same InvalidCredentialsError/message whether the email doesn't exist or the
// password is wrong — deliberately centralized here (not left to the
// controller) so this user-enumeration protection can't be accidentally
// bypassed by a future call site handling the two cases differently.
export async function login(email: string, password: string): Promise<User> {
  const user = await findUserByEmail(email);
  if (!user) throw new InvalidCredentialsError('Invalid email or password.');
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new InvalidCredentialsError('Invalid email or password.');
  return { id: user.id, email: user.email };
}
