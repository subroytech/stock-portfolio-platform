jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import {
  getRandomActiveQuestions, saveUserAnswers, getRandomChallengeQuestions, verifyAnswers,
  InvalidQuestionSelectionError, NoSecurityAnswersError,
} from '../src/services/securityQuestion.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockConnect = pool.connect as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

const ALL_15 = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), question_text: `Question ${i + 1}` }));

describe('getRandomActiveQuestions', () => {
  test('returns exactly n questions drawn from the active set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: ALL_15 });
    const questions = await getRandomActiveQuestions(7);
    expect(questions).toHaveLength(7);
    const ids = new Set(questions.map((q) => q.id));
    expect(ids.size).toBe(7); // no duplicates
    for (const q of questions) expect(ALL_15.some((r) => r.id === q.id)).toBe(true);
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
