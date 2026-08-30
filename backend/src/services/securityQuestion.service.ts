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

export async function getRandomActiveQuestions(n: number): Promise<SecurityQuestion[]> {
  const { rows } = await pool.query<{ id: string; question_text: string }>(
    "SELECT id, question_text FROM m_security_question WHERE status = 'active'",
  );
  return shuffle(rows).slice(0, n).map((r) => ({ id: r.id, questionText: r.question_text }));
}

// Registration submits its own answers for exactly `expectedCount` distinct, real, active
// question ids - there's no server-tracked "which 7 were offered" (the GET endpoint that hands
// them out is stateless), so what's actually validated is simpler and just as sufficient: a
// real count of real, distinct, active questions. There's no adversarial reason to reject a
// user answering different questions than the ones a given page load happened to show them.
export async function saveUserAnswers(
  userId: string,
  answers: { questionId: string; answer: string }[],
  expectedCount: number,
): Promise<void> {
  const ids = answers.map((a) => a.questionId);
  if (answers.length !== expectedCount || new Set(ids).size !== expectedCount) {
    throw new InvalidQuestionSelectionError(`Exactly ${expectedCount} distinct security question answers are required.`);
  }
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

// Picks n of the user's own saved questions at random (e.g. 4 of their 7) for a Forgot Password
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
