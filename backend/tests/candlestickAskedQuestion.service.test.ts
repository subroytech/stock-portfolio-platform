jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import * as svc from '../src/services/candlestickAskedQuestion.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('normalizeQuestionText', () => {
  test('lowercases, trims, and strips trailing punctuation', () => {
    expect(svc.normalizeQuestionText('  What is a Hammer?  ')).toBe('what is a hammer');
    expect(svc.normalizeQuestionText('Is Doji bullish!!!')).toBe('is doji bullish');
    expect(svc.normalizeQuestionText('No trailing punctuation')).toBe('no trailing punctuation');
  });
});

describe('findCachedAnswer', () => {
  test('returns null on a miss, without incrementing anything', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await svc.findCachedAnswer('What is a Hammer?', 'dayTrading');

    expect(result).toBeNull();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`question_asked_count = question_asked_count + 1`);
    expect(sql).toContain(`question_status = 'Answered'`);
    expect(params).toEqual(['what is a hammer', 'dayTrading']);
  });

  test('on a hit, returns the pre-existing answer and pattern names (first answer always wins)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ answer_text: 'A Hammer is bullish.', matched_pattern_names: ['Hammer'] }],
    });

    const result = await svc.findCachedAnswer('What is a Hammer?', 'dayTrading');

    expect(result).toEqual({ answerText: 'A Hammer is bullish.', matchedPatternNames: ['Hammer'] });
  });

  test('a null matched_pattern_names column maps to an empty array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ answer_text: 'Some answer.', matched_pattern_names: null }] });

    const result = await svc.findCachedAnswer('A question', 'longTerm');

    expect(result?.matchedPatternNames).toEqual([]);
  });

  test('only matches rows scoped to the given horizon', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.findCachedAnswer('What is a Hammer?', 'longTerm');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('horizon = $2');
    expect(params).toEqual(['what is a hammer', 'longTerm']);
  });
});

describe('recordAskedQuestion', () => {
  test('inserts a new row with the normalized text, JSON-stringifying matchedPatternNames', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.recordAskedQuestion({
      questionText: 'What is a Hammer?', horizon: 'dayTrading', answerText: 'A Hammer is bullish.',
      matchedPatternNames: ['Hammer'], status: 'Answered',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO m_candlestick_asked_question');
    expect(sql).toContain('ON CONFLICT (normalized_question_text, horizon)');
    expect(params).toEqual([
      'What is a Hammer?', 'what is a hammer', 'dayTrading', 'A Hammer is bullish.', JSON.stringify(['Hammer']), 'Answered',
    ]);
  });

  test('a null answerText (the Unable_To_Answer case) is passed through as-is', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.recordAskedQuestion({
      questionText: 'What is the meaning of life?', horizon: 'longTerm', answerText: null,
      matchedPatternNames: [], status: 'Unable_To_Answer',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
    expect(params[5]).toBe('Unable_To_Answer');
  });
});

describe('listTopQuestions', () => {
  test('filters to Answered-only, ordered by count descending, with a default limit of 100', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        question_text: 'What is a Hammer?', answer_text: 'A Hammer is bullish.',
        matched_pattern_names: ['Hammer'], question_asked_count: '42', last_asked_at: 't1',
      }],
    });

    const result = await svc.listTopQuestions();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`question_status = 'Answered'`);
    expect(sql).toContain('ORDER BY question_asked_count DESC');
    expect(params).toEqual([100]);
    expect(result).toEqual([{
      questionText: 'What is a Hammer?', answerText: 'A Hammer is bullish.',
      matchedPatternNames: ['Hammer'], questionAskedCount: 42, lastAskedAt: 't1',
    }]);
  });

  test('a custom limit is passed through', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.listTopQuestions(10);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([10]);
  });
});
