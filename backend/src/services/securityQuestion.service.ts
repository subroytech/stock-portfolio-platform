// Self-Registration & Password Policy - security-question-based account recovery (no email
// provider needed). Backed by m_security_question (the 15-question master catalog) and
// users_security_answers (each user's own 7 answered questions), both from migration 034.

import bcrypt from 'bcrypt';
import { pool } from '../db/pool';

export class InvalidQuestionSelectionError extends Error {}
export class NoSecurityAnswersError extends Error {}

export interface SecurityQuestion {
  id: string;
  questionText: string;
}

// Shuffles via Fisher-Yates - only 15 rows exist total, so fetching all active and shuffling in
// JS is simpler and just as correct as a SQL RANDOM() ORDER BY at this scale.
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// All 15 (well, however many are active) - the user picks which 7 to answer, rather than the
// old design of the server handing out a random 7. Named "list", not "random" - nothing here
// is randomized anymore (Forgot Password's own challenge-question pick, below, still is).
export async function listActiveQuestions(): Promise<SecurityQuestion[]> {
  const { rows } = await pool.query<{ id: string; question_text: string }>(
    "SELECT id, question_text FROM m_security_question WHERE status = 'active' ORDER BY id",
  );
  return rows.map((r) => ({ id: r.id, questionText: r.question_text }));
}

// Which questions (id + text only, never the answers - they're one-way hashed) this account
// currently has saved. Used both by the post-login "Manage Security Questions" screen (to
// pre-check the user's existing selection) and to tell an admin-created account, which never
// collects any at creation, that it has none yet.
export async function listUserAnswerQuestions(userId: string): Promise<SecurityQuestion[]> {
  const { rows } = await pool.query<{ question_id: string; question_text: string }>(
    `SELECT a.question_id, q.question_text
     FROM users_security_answers a JOIN m_security_question q ON q.id = a.question_id
     WHERE a.user_id = $1
     ORDER BY q.id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.question_id, questionText: r.question_text }));
}

function validateAnswerSelection(answers: { questionId: string; answer: string }[], expectedCount: number): string[] {
  const ids = answers.map((a) => a.questionId);
  if (answers.length !== expectedCount || new Set(ids).size !== expectedCount) {
    throw new InvalidQuestionSelectionError(`Exactly ${expectedCount} distinct security question answers are required.`);
  }
  return ids;
}

// Registration submits its own answers for exactly `expectedCount` distinct, real, active
// question ids - there's no server-tracked "which questions were offered" (the GET endpoint
// that lists them is stateless), so what's actually validated is simpler and just as
// sufficient: a real count of real, distinct, active questions the user themselves chose.
export async function saveUserAnswers(
  userId: string,
  answers: { questionId: string; answer: string }[],
  expectedCount: number,
): Promise<void> {
  const ids = validateAnswerSelection(answers, expectedCount);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM m_security_question WHERE id = ANY($1) AND status = 'active'",
    [ids],
  );
  if (rows.length !== expectedCount) {
    throw new InvalidQuestionSelectionError('One or more security questions are invalid.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { questionId, answer } of answers) {
      const answerHash = await bcrypt.hash(normalizeAnswer(answer), 12);
      await client.query(
        'INSERT INTO users_security_answers (user_id, question_id, answer_hash) VALUES ($1, $2, $3)',
        [userId, questionId, answerHash],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Post-login "Manage Security Questions" - a full replace (delete existing + insert new,
// transactionally), never a partial edit. Since answers are one-way hashed, there's no way to
// "keep" an existing one silently - the caller (auth.controller.ts) already required the
// current password to reach here, same confirmation bar as Change Password. Also how an
// admin-created account (no answers from creation) sets them up for the first time - same
// function, no separate "create" path needed since DELETE on zero existing rows is a no-op.
export async function replaceUserAnswers(
  userId: string,
  answers: { questionId: string; answer: string }[],
  expectedCount: number,
): Promise<void> {
  const ids = validateAnswerSelection(answers, expectedCount);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM m_security_question WHERE id = ANY($1) AND status = 'active'",
    [ids],
  );
  if (rows.length !== expectedCount) {
    throw new InvalidQuestionSelectionError('One or more security questions are invalid.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM users_security_answers WHERE user_id = $1', [userId]);
    for (const { questionId, answer } of answers) {
      const answerHash = await bcrypt.hash(normalizeAnswer(answer), 12);
      await client.query(
        'INSERT INTO users_security_answers (user_id, question_id, answer_hash) VALUES ($1, $2, $3)',
        [userId, questionId, answerHash],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Picks n of the user's own saved questions at random (e.g. 3 of their 5) for a Forgot Password
// challenge. Throws NoSecurityAnswersError if the account never set any up (e.g. admin-created).
export async function getRandomChallengeQuestions(userId: string, n: number): Promise<SecurityQuestion[]> {
  const { rows } = await pool.query<{ question_id: string; question_text: string }>(
    `SELECT a.question_id, q.question_text
     FROM users_security_answers a JOIN m_security_question q ON q.id = a.question_id
     WHERE a.user_id = $1`,
    [userId],
  );
  if (!rows.length) throw new NoSecurityAnswersError('This account has no security questions set up.');
  return shuffle(rows).slice(0, n).map((r) => ({ id: r.question_id, questionText: r.question_text }));
}

// Every answer in `answers` must match the stored hash for that exact question id - a partial
// match (e.g. 3 of 4 correct) still returns false, never revealing which one(s) failed.
export async function verifyAnswers(userId: string, answers: { questionId: string; answer: string }[]): Promise<boolean> {
  if (!answers.length) return false;
  const { rows } = await pool.query<{ question_id: string; answer_hash: string }>(
    'SELECT question_id, answer_hash FROM users_security_answers WHERE user_id = $1 AND question_id = ANY($2)',
    [userId, answers.map((a) => a.questionId)],
  );
  const hashByQuestionId = new Map(rows.map((r) => [r.question_id, r.answer_hash]));
  if (hashByQuestionId.size !== answers.length) return false; // a submitted question id wasn't actually this user's own

  for (const { questionId, answer } of answers) {
    const hash = hashByQuestionId.get(questionId);
    if (!hash || !(await bcrypt.compare(normalizeAnswer(answer), hash))) return false;
  }
  return true;
}

// Case-insensitive, trimmed - so "New York" and "new york " both match, same forgiving
// comparison a human would expect from a personal-question answer.
function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}
