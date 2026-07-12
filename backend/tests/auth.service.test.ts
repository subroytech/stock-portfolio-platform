jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/pool';
import {
  hashPassword, verifyPassword, signToken, verifyToken, createUser, findUserByEmail, login,
  EmailAlreadyExistsError, InvalidCredentialsError,
} from '../src/services/auth.service';

const mockQuery = pool.query as unknown as jest.Mock;

describe('hashPassword / verifyPassword', () => {
  test('a hashed password verifies against the original but not a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  test('hashing the same password twice produces different hashes (salted)', async () => {
    const h1 = await hashPassword('samepassword');
    const h2 = await hashPassword('samepassword');
    expect(h1).not.toBe(h2);
  });
});

describe('signToken / verifyToken', () => {
  test('a signed token verifies back to the same userId', () => {
    const token = signToken('user-123');
    expect(verifyToken(token)).toMatchObject({ userId: 'user-123' });
  });

  test('an invalid token throws', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });

  test('a token signed with a different secret is rejected', () => {
    const bogus = jwt.sign({ userId: 'user-123' }, 'wrong-secret');
    expect(() => verifyToken(bogus)).toThrow();
  });
});

describe('createUser', () => {
  beforeEach(() => mockQuery.mockReset());

  test('inserts and returns the new user (no password hash in the result)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', email: 'a@b.com' }] });
    const user = await createUser('a@b.com', 'hashed');
    expect(user).toEqual({ id: '1', email: 'a@b.com' });
  });

  test('a unique-violation error (code 23505) is translated to EmailAlreadyExistsError', async () => {
    mockQuery.mockRejectedValue({ code: '23505' });
    await expect(createUser('a@b.com', 'hashed')).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  test('other DB errors are rethrown as-is', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'));
    await expect(createUser('a@b.com', 'hashed')).rejects.toThrow('connection lost');
  });
});

describe('findUserByEmail', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns null when no user matches', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await findUserByEmail('nobody@example.com')).toBeNull();
  });

  test('maps password_hash to passwordHash', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', email: 'a@b.com', password_hash: 'hashed' }] });
    const user = await findUserByEmail('a@b.com');
    expect(user).toEqual({ id: '1', email: 'a@b.com', passwordHash: 'hashed' });
  });
});

describe('login', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns the user on correct credentials', async () => {
    const hash = await hashPassword('correctpassword');
    mockQuery.mockResolvedValue({ rows: [{ id: '1', email: 'a@b.com', password_hash: hash }] });
    const user = await login('a@b.com', 'correctpassword');
    expect(user).toEqual({ id: '1', email: 'a@b.com' });
  });

  test('throws InvalidCredentialsError for an unknown email', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(login('nobody@example.com', 'whatever')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('unknown email and wrong password produce the identical error message (no user-enumeration leak)', async () => {
    const hash = await hashPassword('correctpassword');

    mockQuery.mockResolvedValueOnce({ rows: [] });
    let unknownEmailMessage = '';
    try {
      await login('nobody@example.com', 'whatever');
    } catch (e) {
      unknownEmailMessage = (e as Error).message;
    }

    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@b.com', password_hash: hash }] });
    let wrongPasswordMessage = '';
    try {
      await login('a@b.com', 'wrongpassword');
    } catch (e) {
      wrongPasswordMessage = (e as Error).message;
    }

    expect(unknownEmailMessage).toBeTruthy();
    expect(unknownEmailMessage).toBe(wrongPasswordMessage);
  });
});
