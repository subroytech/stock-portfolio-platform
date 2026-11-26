jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  listActiveQuestions, listUserAnswerQuestions, saveUserAnswers, replaceUserAnswers,
  getRandomChallengeQuestions, verifyAnswers, InvalidQuestionSelectionError, NoSecurityAnswersError,
} from '../src/services/securityQuestion.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

const ALL_15 = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), question_text: `Question ${i + 1}` }));

describe('listActiveQuestions', () => {
  test('returns all active questions, unshuffled (the user picks their own N themselves now)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: ALL_15 });
    const questions = await listActiveQuestions();
    expect(questions).toHaveLength(15);
    expect(questions.map((q) => q.id)).toEqual(ALL_15.map((r) => r.id));
  });
});

describe('listUserAnswerQuestions', () => {
  test('returns the questions (id+text only) this account currently has saved', async () => {
    const saved = [{ question_id: '3', question_text: 'Question 3' }, { question_id: '7', question_text: 'Question 7' }];
    mockQuery.mockResolvedValueOnce({ rows: saved });
    const questions = await listUserAnswerQuestions('1');
    expect(questions).toEqual([{ id: '3', questionText: 'Question 3' }, { id: '7', questionText: 'Question 7' }]);
  });

  test('returns an empty array for an account with none saved (e.g. admin-created)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await listUserAnswerQuestions('1')).toEqual([]);
  });
});

function mockTransactionClient() {
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return Promise.resolve({});
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

describe('saveUserAnswers', () => {
  const sevenAnswers = Array.from({ length: 7 }, (_, i) => ({ questionId: String(i + 1), answer: `Answer${i}` }));

  test('inserts all 7 answers transactionally when every id is real and active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.map((a) => ({ id: a.questionId })) }); // validation SELECT
    const client = mockTransactionClient();
    mockConnect.mockResolvedValue(client);

    await saveUserAnswers('7', sevenAnswers, 7);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const inserts = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO users_security_answers'));
    expect(inserts).toHaveLength(7);
  });

  test('rejects a duplicate question id even if the count matches', async () => {
    const withDupe = [...sevenAnswers.slice(0, 6), { questionId: sevenAnswers[0].questionId, answer: 'dupe' }];
    await expect(saveUserAnswers('7', withDupe, 7)).rejects.toBeInstanceOf(InvalidQuestionSelectionError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects when a submitted id does not exist / is not active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.slice(0, 6).map((a) => ({ id: a.questionId })) }); // one id missing
    await expect(saveUserAnswers('7', sevenAnswers, 7)).rejects.toBeInstanceOf(InvalidQuestionSelectionError);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('rolls back the transaction if an insert fails partway through', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.map((a) => ({ id: a.questionId })) });
    const client = mockTransactionClient();
    client.query.mockImplementationOnce((sql: string) => (sql.startsWith('BEGIN') ? Promise.resolve({}) : Promise.resolve({})))
      .mockImplementationOnce(() => { throw new Error('insert failed'); });
    mockConnect.mockResolvedValue(client);

    await expect(saveUserAnswers('7', sevenAnswers, 7)).rejects.toThrow('insert failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('replaceUserAnswers', () => {
  const sevenAnswers = Array.from({ length: 7 }, (_, i) => ({ questionId: String(i + 1), answer: `Answer${i}` }));

  test('deletes the existing set then inserts the new 7, transactionally', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.map((a) => ({ id: a.questionId })) }); // validation SELECT
    const client = mockTransactionClient();
    mockConnect.mockResolvedValue(client);

    await replaceUserAnswers('7', sevenAnswers, 7);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('DELETE FROM users_security_answers WHERE user_id = $1', ['7']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const inserts = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO users_security_answers'));
    expect(inserts).toHaveLength(7);
  });

  test('the DELETE runs before any INSERT (a real full replace, not an append)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.map((a) => ({ id: a.questionId })) });
    const client = mockTransactionClient();
    mockConnect.mockResolvedValue(client);

    await replaceUserAnswers('7', sevenAnswers, 7);

    const calls = client.query.mock.calls.map(([sql]) => String(sql));
    const deleteIdx = calls.findIndex((sql) => sql.startsWith('DELETE FROM users_security_answers'));
    const firstInsertIdx = calls.findIndex((sql) => sql.includes('INSERT INTO users_security_answers'));
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(firstInsertIdx);
  });

  test('works fine for an account with no existing answers (the DELETE is just a no-op)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: sevenAnswers.map((a) => ({ id: a.questionId })) });
    const client = mockTransactionClient(); // DELETE on an empty table still resolves normally
    mockConnect.mockResolvedValue(client);

    await expect(replaceUserAnswers('7', sevenAnswers, 7)).resolves.toBeUndefined();
  });

  test('rejects an invalid selection before ever connecting for the transaction', async () => {
    const withDupe = [...sevenAnswers.slice(0, 6), { questionId: sevenAnswers[0].questionId, answer: 'dupe' }];
    await expect(replaceUserAnswers('7', withDupe, 7)).rejects.toBeInstanceOf(InvalidQuestionSelectionError);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('getRandomChallengeQuestions', () => {
  test('picks n of the user\'s own saved questions', async () => {
    const saved = Array.from({ length: 7 }, (_, i) => ({ question_id: String(i + 1), question_text: `Q${i + 1}` }));
    mockQuery.mockResolvedValueOnce({ rows: saved });
    const challenge = await getRandomChallengeQuestions('7', 4);
    expect(challenge).toHaveLength(4);
    for (const c of challenge) expect(saved.some((s) => s.question_id === c.id)).toBe(true);
  });

  test('throws NoSecurityAnswersError when the account has none saved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getRandomChallengeQuestions('7', 4)).rejects.toBeInstanceOf(NoSecurityAnswersError);
  });
});

describe('verifyAnswers', () => {
  test('true only when every answer matches its stored hash (case-insensitive, trimmed)', async () => {
    const bcrypt = jest.requireActual('bcrypt');
    const hash = await bcrypt.hash('new york', 4);
    mockQuery.mockResolvedValueOnce({ rows: [{ question_id: 'q1', answer_hash: hash }] });
    expect(await verifyAnswers('7', [{ questionId: 'q1', answer: ' New York ' }])).toBe(true);
  });

  test('false if any single answer is wrong, without revealing which', async () => {
    const bcrypt = jest.requireActual('bcrypt');
    const hash1 = await bcrypt.hash('correct1', 4);
    const hash2 = await bcrypt.hash('correct2', 4);
    mockQuery.mockResolvedValueOnce({ rows: [{ question_id: 'q1', answer_hash: hash1 }, { question_id: 'q2', answer_hash: hash2 }] });
    expect(await verifyAnswers('7', [{ questionId: 'q1', answer: 'correct1' }, { questionId: 'q2', answer: 'WRONG' }])).toBe(false);
  });

  test('false if a submitted question id is not actually one of this user\'s saved answers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await verifyAnswers('7', [{ questionId: 'not-mine', answer: 'anything' }])).toBe(false);
  });
});
