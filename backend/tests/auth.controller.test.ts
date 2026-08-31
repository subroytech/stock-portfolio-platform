jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// This file's test count grew a lot with Self-Registration & Password Policy's new endpoints -
// enough real requests against the real /auth router (mounted with rateLimiters in app.ts) to
// trip the actual per-IP/per-user limiter mid-run. Same no-op mock already used by
// portfolio.controller.test.ts for the same reason.
jest.mock('../src/middleware/rateLimit', () => ({
  __esModule: true,
  default: [(_req: unknown, _res: unknown, next: () => void) => next(), (_req: unknown, _res: unknown, next: () => void) => next()],
}));
jest.mock('../src/services/impersonation.service', () => ({
  ...jest.requireActual('../src/services/impersonation.service'),
  startImpersonation: jest.fn(),
  endImpersonation: jest.fn(),
}));
import request from 'supertest';
import { pool } from '../src/db/pool';
import { hashPassword, signToken, signPasswordResetChallengeToken, signPasswordResetToken } from '../src/services/auth.service';
import * as impersonationService from '../src/services/impersonation.service';
import app from '../src/app';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;
const mockStartImpersonation = impersonationService.startImpersonation as jest.Mock;
const mockEndImpersonation = impersonationService.endImpersonation as jest.Mock;

// Self-Registration & Password Policy: signup() no longer assigns a role (that's now an admin
// step, see the describe block below) but DOES save 5 security answers transactionally via
// pool.connect() (securityQuestion.service.ts's saveUserAnswers) - a mock client so that
// transaction succeeds without needing a real DB.
function mockSecurityAnswerClient() {
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
    return Promise.resolve({ rows: [] }); // INSERT INTO users_security_answers
  });
  return { query, release: jest.fn() };
}

// A password meeting every rule (15-25 chars, upper+number+special, no name/email overlap) and
// 5 distinct security answers - the minimum a signup request needs to get past validation.
const VALID_SIGNUP_PAYLOAD = {
  email: 'new@example.com',
  firstName: 'Jordan',
  lastName: 'Rivera',
  password: 'Str0ng!PasswordXYZ',
  securityAnswers: ['q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => ({ questionId: id, answer: `Answer${i}` })),
};

// Keyed on distinguishing SQL substrings (not just startsWith('SELECT'/'INSERT'), since a full
// signup issues several different SELECTs/INSERTs each needing its own response) - same
// substring-matching precedent as this file's own mockSessionQueries() below.
function mockSignupDb({ existingUser, insertedUser }: {
  existingUser?: DbUserRow;
  insertedUser?: { id: string; email: string; status: string; first_name: string; last_name: string };
} = {}) {
  mockQuery.mockImplementation((text: string, params?: unknown[]) => {
    if (text.includes('FROM users WHERE email')) return Promise.resolve({ rows: existingUser ? [existingUser] : [] });
    if (text.startsWith('INSERT INTO users ')) return Promise.resolve({ rows: insertedUser ? [insertedUser] : [] });
    if (text.includes('FROM m_security_question')) {
      // Echoes back exactly the ids that were asked about, simulating "all valid & active."
      const ids = (params?.[0] as string[] | undefined) ?? [];
      return Promise.resolve({ rows: ids.map((id) => ({ id })) });
    }
    if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: insertedUser ? [insertedUser] : [] });
    return Promise.resolve({ rows: [] }); // password-history insert/prune, roles/permissions lookups
  });
}

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string;
  status?: string;
}

// signup/login both start with a SELECT (existing-email check / credential
// lookup); signup follows with an INSERT if that SELECT came back empty.
// Keyed on SQL text rather than call order so each test only has to describe
// what's "in the database," not the exact query sequence.
function mockDb({ existingUser, insertedUser }: { existingUser?: DbUserRow; insertedUser?: { id: string; email: string } } = {}) {
  // Defaults status to 'active' so every pre-existing test (written before login()
  // started checking status) keeps describing an account that can actually log in,
  // unless a test deliberately overrides it to exercise the new status gate.
  const resolvedExistingUser = existingUser ? { status: 'active', ...existingUser } : undefined;
  mockQuery.mockImplementation((text: string) => {
    if (text.startsWith('SELECT')) {
      return Promise.resolve({ rows: resolvedExistingUser ? [resolvedExistingUser] : [] });
    }
    if (text.startsWith('INSERT')) {
      return Promise.resolve({ rows: insertedUser ? [insertedUser] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function getCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((c: string) => c.startsWith('auth_token=')) || '';
}

describe('POST /auth/signup', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(mockSecurityAnswerClient());
  });

  test('registers a pending account (no role assigned) and sets the auth cookie', async () => {
    mockSignupDb({ insertedUser: { id: '1', email: 'new@example.com', status: 'pending', first_name: 'Jordan', last_name: 'Rivera' } });
    const res = await request(app).post('/auth/signup').send(VALID_SIGNUP_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('1');
    expect(res.body.status).toBe('pending');
    // Self-Registration & Password Policy's core behavior change from the old signup: no
    // baseline role is granted - only an admin assigning one (Manage Users) unlocks the account.
    // (resolveSession() still legitimately READS users_roles afterward to confirm zero roles -
    // that's not what's being asserted against here, only an actual INSERT would be.)
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO users_roles'))).toBe(false);
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('rejects an already-registered email with 409', async () => {
    mockSignupDb({ existingUser: { id: '1', email: 'dup@example.com', password_hash: 'x' } });
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, email: 'dup@example.com' });
    expect(res.status).toBe(409);
  });

  test('rejects an invalid email with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('rejects a password that fails the policy with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, password: 'short' });
    expect(res.status).toBe(400);
  });

  test('rejects a password containing the user\'s first name with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, password: 'Jordan1234567890!Extra' });
    expect(res.status).toBe(400);
  });

  test('rejects fewer than 5 security answers with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, securityAnswers: VALID_SIGNUP_PAYLOAD.securityAnswers.slice(0, 3) });
    expect(res.status).toBe(400);
  });

  test('missing first/last name is rejected with 400', async () => {
    const res = await request(app).post('/auth/signup').send({ ...VALID_SIGNUP_PAYLOAD, firstName: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => mockQuery.mockReset());

  test('logs in with correct credentials and sets the auth cookie', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'correctpassword' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
    expect(res.body.email).toBe('a@b.com');
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('a pending account can still log in (frontend, not login itself, gates it to the banner)', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash, status: 'pending' } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'correctpassword' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  test('rejects a wrong password with 401', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects correct credentials for a deactivated account with 401', async () => {
    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash, status: 'deactivated' } });
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'correctpassword' });
    expect(res.status).toBe(401);
  });

  test('rejects an unknown email with 401 and the same message as a wrong password', async () => {
    mockDb({});
    const unknownRes = await request(app).post('/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(unknownRes.status).toBe(401);

    const passwordHash = await hashPassword('correctpassword');
    mockDb({ existingUser: { id: '1', email: 'a@b.com', password_hash: passwordHash } });
    const wrongRes = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'wrongpassword' });

    expect(unknownRes.body.error).toBe(wrongRes.body.error);
  });
});

describe('POST /auth/logout', () => {
  test('clears the auth cookie', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(getCookie(res)).toMatch(/^auth_token=;/);
  });
});

describe('GET /auth/me', () => {
  beforeEach(() => mockQuery.mockReset());

  test('401 without a session cookie', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('200 with { id, email, roles, permissions } for a valid session', async () => {
    const authCookie = `auth_token=${signToken('1')}`;
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com' }] });
      // Checked before the generic 'users_roles' branch - getUserPermissions' query also
      // contains 'users_roles' (it joins through it), so the more specific substring must
      // win or every role-name row would get misread as a permission-key row.
      if (text.includes('m_role_permissions')) return Promise.resolve({ rows: [{ permission_key: 'contrarian_finder:scan' }] });
      if (text.includes('users_roles')) return Promise.resolve({ rows: [{ name: 'user' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '1', email: 'a@b.com', roles: ['user'], permissions: ['contrarian_finder:scan'], impersonating: false });
  });

  test('401 if the session references a user that no longer exists', async () => {
    const authCookie = `auth_token=${signToken('999')}`;
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(401);
  });

  test('impersonating: true when the token carries impersonatedBy', async () => {
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ id: '2', email: 'target@b.com' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).get('/auth/me').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.impersonating).toBe(true);
  });
});

// Shared query mock for impersonate/stop-impersonating - requirePermission's own check query
// also contains "m_role_permissions" (same substring-matching precedent as GET /auth/me's own
// test above), so a non-empty `permissions` list doubles as "the gate passes."
function mockSessionQueries(userRow: { id: string; email: string } | null, roles: string[] = [], permissions: string[] = []) {
  mockQuery.mockImplementation((text: string) => {
    if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: userRow ? [userRow] : [] });
    if (text.includes('m_role_permissions')) return Promise.resolve({ rows: permissions.map((p) => ({ permission_key: p })) });
    if (text.includes('users_roles')) return Promise.resolve({ rows: roles.map((r) => ({ name: r })) });
    return Promise.resolve({ rows: [] });
  });
}

describe('POST /auth/impersonate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockStartImpersonation.mockReset();
    mockEndImpersonation.mockReset();
  });

  test('403 without users:impersonate', async () => {
    mockSessionQueries(null, [], []); // no permissions granted
    const authCookie = `auth_token=${signToken('1')}`;
    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(403);
    expect(mockStartImpersonation).not.toHaveBeenCalled();
  });

  test('409 when already impersonating', async () => {
    mockSessionQueries(null, [], ['users:impersonate']);
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;
    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '3' });
    expect(res.status).toBe(409);
    expect(mockStartImpersonation).not.toHaveBeenCalled();
  });

  test('200 sets a new cookie for the target user', async () => {
    mockSessionQueries({ id: '2', email: 'target@b.com' }, ['user'], ['users:impersonate']);
    mockStartImpersonation.mockResolvedValue({ id: '2', email: 'target@b.com' });
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('2');
    expect(res.body.impersonating).toBe(true);
    expect(mockStartImpersonation).toHaveBeenCalledWith('1', '2');
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });

  test('404 when the target does not exist', async () => {
    const { TargetUserNotFoundError } = jest.requireActual('../src/services/impersonation.service');
    mockSessionQueries(null, [], ['users:impersonate']);
    mockStartImpersonation.mockRejectedValue(new TargetUserNotFoundError('gone'));
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '999' });
    expect(res.status).toBe(404);
  });

  test('403 when the target holds admin-console access', async () => {
    const { CannotImpersonateAdminError } = jest.requireActual('../src/services/impersonation.service');
    mockSessionQueries(null, [], ['users:impersonate']);
    mockStartImpersonation.mockRejectedValue(new CannotImpersonateAdminError('blocked'));
    const authCookie = `auth_token=${signToken('1')}`;

    const res = await request(app).post('/auth/impersonate').set('Cookie', authCookie).send({ userId: '2' });
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/change-password', () => {
  beforeEach(() => mockQuery.mockReset());

  function mockChangePasswordDb({ currentPasswordHash, reusedHashes = [] }: { currentPasswordHash: string; reusedHashes?: string[] }) {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) {
        return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com', status: 'active', first_name: 'Jordan', last_name: 'Rivera', password_hash: currentPasswordHash }] });
      }
      if (text.includes('FROM user_evt_password_history')) {
        return Promise.resolve({ rows: reusedHashes.map((h) => ({ password_hash: h })) });
      }
      return Promise.resolve({ rows: [] }); // UPDATE users / INSERT+DELETE user_evt_password_history
    });
  }

  test('401 without a session', async () => {
    const res = await request(app).post('/auth/change-password').send({ currentPassword: 'x', newPassword: 'y' });
    expect(res.status).toBe(401);
  });

  test('401 when the current password is wrong', async () => {
    mockChangePasswordDb({ currentPasswordHash: await hashPassword('CorrectCurrent1!Xyz') });
    const res = await request(app).post('/auth/change-password').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'WrongOne1!Xyz', newPassword: 'NewStr0ng!PasswordAbc' });
    expect(res.status).toBe(401);
  });

  test('400 when the new password fails the policy', async () => {
    mockChangePasswordDb({ currentPasswordHash: await hashPassword('CorrectCurrent1!Xyz') });
    const res = await request(app).post('/auth/change-password').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'CorrectCurrent1!Xyz', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('400 when the new password repeats one of the last 5', async () => {
    const reusedHash = await hashPassword('OldPassword1!Xyz00');
    mockChangePasswordDb({ currentPasswordHash: await hashPassword('CorrectCurrent1!Xyz'), reusedHashes: [reusedHash] });
    const res = await request(app).post('/auth/change-password').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'CorrectCurrent1!Xyz', newPassword: 'OldPassword1!Xyz00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last 5/i);
  });

  test('200 on success, and records the new password in history', async () => {
    mockChangePasswordDb({ currentPasswordHash: await hashPassword('CorrectCurrent1!Xyz') });
    const res = await request(app).post('/auth/change-password').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'CorrectCurrent1!Xyz', newPassword: 'NewStr0ng!PasswordAbc' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO user_evt_password_history'))).toBe(true);
  });
});

describe('GET /auth/security-questions', () => {
  beforeEach(() => mockQuery.mockReset());

  test('200 with all 15 questions, public (no session needed)', async () => {
    const all15 = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), question_text: `Question ${i + 1}` }));
    mockQuery.mockResolvedValueOnce({ rows: all15 });
    const res = await request(app).get('/auth/security-questions');
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(15);
  });
});

describe('GET /auth/security-questions/mine', () => {
  beforeEach(() => mockQuery.mockReset());

  test('401 without a session', async () => {
    const res = await request(app).get('/auth/security-questions/mine');
    expect(res.status).toBe(401);
  });

  test('200 with the account\'s currently-saved questions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ question_id: '3', question_text: 'Question 3' }] });
    const res = await request(app).get('/auth/security-questions/mine').set('Cookie', `auth_token=${signToken('1')}`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([{ id: '3', questionText: 'Question 3' }]);
  });

  test('200 with an empty list for an admin-created account with none saved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/auth/security-questions/mine').set('Cookie', `auth_token=${signToken('1')}`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });
});

describe('PUT /auth/security-questions', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
  });

  const fiveAnswers = Array.from({ length: 5 }, (_, i) => ({ questionId: String(i + 1), answer: `Answer${i}` }));

  function mockUpdateSecurityQuestionsDb(currentPasswordHash: string) {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ password_hash: currentPasswordHash }] });
      if (text.includes('FROM m_security_question')) return Promise.resolve({ rows: fiveAnswers.map((a) => ({ id: a.questionId })) });
      return Promise.resolve({ rows: [] }); // DELETE/INSERT inside the transaction client, not pool.query
    });
  }

  test('401 without a session', async () => {
    const res = await request(app).put('/auth/security-questions').send({ currentPassword: 'x', securityAnswers: fiveAnswers });
    expect(res.status).toBe(401);
  });

  test('401 when the current password is wrong', async () => {
    mockUpdateSecurityQuestionsDb(await hashPassword('CorrectCurrent1!Xyz'));
    const res = await request(app).put('/auth/security-questions').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'WrongOne1!Xyz', securityAnswers: fiveAnswers });
    expect(res.status).toBe(401);
  });

  test('400 when fewer than 5 answers are submitted', async () => {
    mockUpdateSecurityQuestionsDb(await hashPassword('CorrectCurrent1!Xyz'));
    const res = await request(app).put('/auth/security-questions').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'CorrectCurrent1!Xyz', securityAnswers: fiveAnswers.slice(0, 3) });
    expect(res.status).toBe(400);
  });

  test('200 on success, replacing the full set (works the same for a first-time setup with none existing)', async () => {
    mockUpdateSecurityQuestionsDb(await hashPassword('CorrectCurrent1!Xyz'));
    mockConnect.mockResolvedValue({
      query: jest.fn((sql: string) => (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK') ? Promise.resolve({}) : Promise.resolve({ rows: [] }))),
      release: jest.fn(),
    });
    const res = await request(app).put('/auth/security-questions').set('Cookie', `auth_token=${signToken('1')}`)
      .send({ currentPassword: 'CorrectCurrent1!Xyz', securityAnswers: fiveAnswers });
    expect(res.status).toBe(200);
  });
});

describe('POST /auth/forgot-password/start', () => {
  beforeEach(() => mockQuery.mockReset());

  test('404 when no account exists for that email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/auth/forgot-password/start').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(404);
  });

  test('404 when the account has no saved security answers', async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE email')) return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com', status: 'active' }] });
      if (text.includes('users_security_answers')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/auth/forgot-password/start').send({ email: 'a@b.com' });
    expect(res.status).toBe(404);
  });

  test('200 with 3 challenge questions + a challenge token when the account has saved answers', async () => {
    const saved = Array.from({ length: 5 }, (_, i) => ({ question_id: String(i + 1), question_text: `Q${i + 1}` }));
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE email')) return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com', status: 'active' }] });
      if (text.includes('users_security_answers')) return Promise.resolve({ rows: saved });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/auth/forgot-password/start').send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(3);
    expect(typeof res.body.challengeToken).toBe('string');
  });
});

describe('POST /auth/forgot-password/verify', () => {
  beforeEach(() => mockQuery.mockReset());

  test('401 with an invalid/expired/tampered challenge token', async () => {
    const res = await request(app).post('/auth/forgot-password/verify').send({
      challengeToken: 'not-a-real-token',
      answers: [{ questionId: '1', answer: 'x' }, { questionId: '2', answer: 'x' }, { questionId: '3', answer: 'x' }],
    });
    expect(res.status).toBe(401);
  });

  test('400 when the submitted question ids do not match what was challenged', async () => {
    const token = signPasswordResetChallengeToken('1', ['1', '2', '3']);
    const res = await request(app).post('/auth/forgot-password/verify').send({
      challengeToken: token,
      answers: [{ questionId: '1', answer: 'x' }, { questionId: '2', answer: 'x' }, { questionId: '999', answer: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  test('401 when any answer is wrong; 200 with a resetToken when all 3 are correct', async () => {
    const bcrypt = jest.requireActual('bcrypt');
    const hashes = await Promise.all(['ans1', 'ans2', 'ans3'].map((a) => bcrypt.hash(a, 4)));
    const token = signPasswordResetChallengeToken('1', ['1', '2', '3']);
    const answerRows = hashes.map((h, i) => ({ question_id: String(i + 1), answer_hash: h }));

    mockQuery.mockResolvedValueOnce({ rows: answerRows });
    const wrongRes = await request(app).post('/auth/forgot-password/verify').send({
      challengeToken: token,
      answers: [{ questionId: '1', answer: 'ans1' }, { questionId: '2', answer: 'ans2' }, { questionId: '3', answer: 'WRONG' }],
    });
    expect(wrongRes.status).toBe(401);

    mockQuery.mockResolvedValueOnce({ rows: answerRows });
    const correctRes = await request(app).post('/auth/forgot-password/verify').send({
      challengeToken: token,
      answers: [{ questionId: '1', answer: 'ans1' }, { questionId: '2', answer: 'ans2' }, { questionId: '3', answer: 'ans3' }],
    });
    expect(correctRes.status).toBe(200);
    expect(typeof correctRes.body.resetToken).toBe('string');
  });
});

describe('POST /auth/forgot-password/reset', () => {
  beforeEach(() => mockQuery.mockReset());

  test('401 with an invalid/expired reset token', async () => {
    const res = await request(app).post('/auth/forgot-password/reset').send({ resetToken: 'nope', newPassword: 'NewStr0ng!PasswordAbc' });
    expect(res.status).toBe(401);
  });

  test('400 when the new password fails policy, given a real reset token', async () => {
    const token = signPasswordResetToken('1');
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@b.com', status: 'active', first_name: null, last_name: null }] });
    const res = await request(app).post('/auth/forgot-password/reset').send({ resetToken: token, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('200 on success, and records the new password in history', async () => {
    const token = signPasswordResetToken('1');
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('FROM users WHERE id')) return Promise.resolve({ rows: [{ id: '1', email: 'a@b.com', status: 'active', first_name: null, last_name: null }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/auth/forgot-password/reset').send({ resetToken: token, newPassword: 'NewStr0ng!PasswordAbc' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO user_evt_password_history'))).toBe(true);
  });
});

describe('POST /auth/stop-impersonating', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockStartImpersonation.mockReset();
    mockEndImpersonation.mockReset();
  });

  test('400 when not currently impersonating', async () => {
    const authCookie = `auth_token=${signToken('1')}`;
    const res = await request(app).post('/auth/stop-impersonating').set('Cookie', authCookie);
    expect(res.status).toBe(400);
    expect(mockEndImpersonation).not.toHaveBeenCalled();
  });

  test('200 restores the original admin\'s own session', async () => {
    mockSessionQueries({ id: '1', email: 'admin@b.com' }, ['admin-master'], ['users:impersonate']);
    mockEndImpersonation.mockResolvedValue(undefined);
    const authCookie = `auth_token=${signToken('2', { impersonatedBy: '1' })}`;

    const res = await request(app).post('/auth/stop-impersonating').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
    expect(res.body.impersonating).toBe(false);
    expect(mockEndImpersonation).toHaveBeenCalledWith('1', '2');
    expect(getCookie(res)).toMatch(/^auth_token=.+; Max-Age=/);
  });
});
