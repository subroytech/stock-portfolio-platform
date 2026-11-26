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

    const result = await svc.findCachedAnswer('What is a Hammer?');

    expect(result).toBeNull();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`question_asked_count = question_asked_count + 1`);
    expect(sql).toContain(`question_status = 'Answered'`);
    expect(params).toEqual(['what is a hammer']);
  });

  test('on a hit, returns the pre-existing answer, enriched pattern names, resolvedVia, fromGeneralKnowledge, and the row\'s own stored horizon (first answer always wins)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ answer_text: 'A Hammer is bullish.', matched_pattern_names: [{ patternName: 'Hammer', relevantForHorizon: true }], resolved_via: 'template', from_general_knowledge: false, horizon: 'dayTrading' }],
    });

    const result = await svc.findCachedAnswer('What is a Hammer?');

    expect(result).toEqual({
      answerText: 'A Hammer is bullish.', matchedPatternNames: [{ patternName: 'Hammer', relevantForHorizon: true }],
      resolvedVia: 'template', fromGeneralKnowledge: false, horizon: 'dayTrading',
    });
  });

  test('a null matched_pattern_names column maps to an empty array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ answer_text: 'Some answer.', matched_pattern_names: null, resolved_via: 'llm', from_general_knowledge: false, horizon: 'longTerm' }] });

    const result = await svc.findCachedAnswer('A question');

    expect(result?.matchedPatternNames).toEqual([]);
  });

  test('a null resolved_via column (a row written before this feature shipped) is passed through as null, not guessed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ answer_text: 'Some answer.', matched_pattern_names: [], resolved_via: null, from_general_knowledge: false, horizon: 'longTerm' }] });

    const result = await svc.findCachedAnswer('A question');

    expect(result?.resolvedVia).toBeNull();
  });

  test('a true from_general_knowledge column is passed through as-is', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ answer_text: 'General knowledge answer.', matched_pattern_names: [], resolved_via: 'llm', from_general_knowledge: true, horizon: 'longTerm' }] });

    const result = await svc.findCachedAnswer('A question');

    expect(result?.fromGeneralKnowledge).toBe(true);
  });

  // 2026-10-10 - horizon dropped out of the cache lookup key itself (migration 070): the same
  // question is now recognized as a hit regardless of which horizon it was originally asked
  // under, closing a real bug where re-asking under a different horizon than before (e.g. after
  // the Ask form's own default horizon changed) cost a second real LLM call instead of being
  // treated as a repeat.
  test('matches a cached row regardless of which horizon it is called with - horizon no longer scopes the lookup', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.findCachedAnswer('What is a Hammer?');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('horizon = $2');
    expect(params).toEqual(['what is a hammer']);
  });
});

describe('recordAskedQuestion', () => {
  test('inserts a new row with the normalized text, JSON-stringifying matchedPatternNames', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const matchedPatternNames = [{ patternName: 'Hammer', relevantForHorizon: true }];
    await svc.recordAskedQuestion({
      questionText: 'What is a Hammer?', horizon: 'dayTrading', answerText: 'A Hammer is bullish.',
      matchedPatternNames, status: 'Answered', resolvedVia: 'template', fromGeneralKnowledge: false,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO m_candlestick_asked_question');
    expect(sql).toContain('ON CONFLICT (normalized_question_text)'); // 2026-10-10 - horizon dropped from the key
    expect(params).toEqual([
      'What is a Hammer?', 'what is a hammer', 'dayTrading', 'A Hammer is bullish.', JSON.stringify(matchedPatternNames), 'Answered', 'template', false,
    ]);
  });

  test('a null answerText (the Unable_To_Answer case) is passed through as-is', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.recordAskedQuestion({
      questionText: 'What is the meaning of life?', horizon: 'longTerm', answerText: null,
      matchedPatternNames: [], status: 'Unable_To_Answer', resolvedVia: 'none', fromGeneralKnowledge: false,
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
    expect(params[5]).toBe('Unable_To_Answer');
    expect(params[6]).toBe('none');
    expect(params[7]).toBe(false);
  });

  test('a true fromGeneralKnowledge is passed through as-is', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.recordAskedQuestion({
      questionText: 'Can Tasuki Gap be used with other patterns?', horizon: 'dayTrading', answerText: 'General knowledge answer.',
      matchedPatternNames: [], status: 'Answered', resolvedVia: 'llm', fromGeneralKnowledge: true,
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[7]).toBe(true);
  });

  // 2026-10-10 - real bug found live: a retry that actually succeeded (e.g. after switching to
  // a stronger model) was silently discarded, since ON CONFLICT only ever bumped the counter.
  describe('upgrading a previously-failed row on a later success', () => {
    test('the generated SQL only upgrades answer_text/status/etc. when the existing row is NOT already Answered and the new attempt IS', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await svc.recordAskedQuestion({
        questionText: 'Can Tasuke Gap be used in conjunction with other patterns?', horizon: 'all',
        answerText: 'A real answer this time.', matchedPatternNames: [], status: 'Answered', resolvedVia: 'llm', fromGeneralKnowledge: true,
      });

      const [sql] = mockQuery.mock.calls[0];
      const upgradeCondition = `m_candlestick_asked_question.question_status != 'Answered' AND EXCLUDED.question_status = 'Answered'`;
      expect(sql).toContain(upgradeCondition);
      // Every upgradeable column is gated by that same condition, falling back to its own
      // current value otherwise - never silently clobbering an already-Answered row.
      for (const column of ['question_text', 'horizon', 'answer_text', 'matched_pattern_names', 'question_status', 'resolved_via', 'from_general_knowledge']) {
        expect(sql).toContain(`${column} = CASE WHEN ${upgradeCondition} THEN EXCLUDED.${column} ELSE m_candlestick_asked_question.${column} END`);
      }
      // question_asked_count/last_asked_at are unconditional - every conflict bumps them,
      // upgrade or not.
      expect(sql).toContain('question_asked_count = m_candlestick_asked_question.question_asked_count + 1');
      expect(sql).toContain('last_asked_at = now()');
    });
  });
});

describe('listTopQuestions', () => {
  test('filters to Answered-only, ordered by count descending, with a default limit of 100', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'q1', question_text: 'What is a Hammer?', answer_text: 'A Hammer is bullish.',
        matched_pattern_names: [{ patternName: 'Hammer', relevantForHorizon: true }], question_asked_count: '42', last_asked_at: 't1',
        resolved_via: 'llm', from_general_knowledge: true,
      }],
    });

    const result = await svc.listTopQuestions();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('SELECT id,');
    expect(sql).toContain(`question_status = 'Answered'`);
    expect(sql).toContain('ORDER BY question_asked_count DESC');
    expect(params).toEqual([100]);
    expect(result).toEqual([{
      id: 'q1', questionText: 'What is a Hammer?', answerText: 'A Hammer is bullish.',
      matchedPatternNames: [{ patternName: 'Hammer', relevantForHorizon: true }], questionAskedCount: 42, lastAskedAt: 't1',
      resolvedVia: 'llm', fromGeneralKnowledge: true,
    }]);
  });

  test('a custom limit is passed through', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.listTopQuestions(10);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([10]);
  });
});

describe('deleteAskedQuestion', () => {
  test('deletes the row by id and returns true when a row was actually removed', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await svc.deleteAskedQuestion('q1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM m_candlestick_asked_question');
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual(['q1']);
    expect(result).toBe(true);
  });

  test('returns false when no row matched the given id', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await svc.deleteAskedQuestion('nonexistent');

    expect(result).toBe(false);
  });
});
