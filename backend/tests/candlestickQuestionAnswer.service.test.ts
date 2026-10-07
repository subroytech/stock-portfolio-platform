jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));

import { pool } from '../src/db/pool';
import * as svc from '../src/services/candlestickQuestionAnswer.service';

const mockQuery = pool.query as unknown as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
});

const ROW = {
  id: 'e1', pattern_id: 'p1', pattern_name: 'Doji', category: 'Definition', tier: 101,
  question_text: 'What is a Doji?', answer_text: 'A Doji is...', status: 'Approved',
  created_by: null, reviewed_by: null, reviewed_at: null, created_at: 't1', updated_at: 't1',
};

describe('searchEntries', () => {
  test('always filters to Approved-only, with no other filters when none are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW] });

    const result = await svc.searchEntries();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`e.status = 'Approved'`);
    expect(params).toEqual([]);
    expect(result).toEqual([{
      id: 'e1', patternId: 'p1', patternName: 'Doji', category: 'Definition', tier: 101,
      questionText: 'What is a Doji?', answerText: 'A Doji is...', status: 'Approved',
      createdBy: null, reviewedBy: null, reviewedAt: null, createdAt: 't1', updatedAt: 't1',
    }]);
  });

  // horizon is resolved via the PATTERN's own boolean columns (migration 048), not a column on
  // the entry - no parameter is bound for it (the column name itself varies by horizon, not a
  // parameterized value), unlike tier/query below.
  test('adds a horizon filter (via the pattern\'s boolean column) when given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.searchEntries({ horizon: 'mediumTerm' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.is_medium_term = true');
    expect(params).toEqual([]);
  });

  test('a different horizon references its own distinct boolean column', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.searchEntries({ horizon: 'longTerm' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.is_long_term = true');
  });

  test('adds a tier filter when given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.searchEntries({ tier: 201 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('e.tier = $1');
    expect(params).toEqual([201]);
  });

  test('a free-text query searches both question_text and the pattern name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.searchEntries({ query: 'hammer' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('e.question_text ILIKE $1');
    expect(sql).toContain('p.pattern_name ILIKE $1');
    expect(params).toEqual(['%hammer%']);
  });

  test('combines horizon (unparameterized) + tier + query together with correct parameter positions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.searchEntries({ query: 'star', horizon: 'longTerm', tier: 301 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.is_long_term = true');
    // horizon takes no parameter slot, so tier ($1) and query ($2) are the only bound params.
    expect(params).toEqual([301, '%star%']);
  });
});

const METADATA_ROW = {
  pattern_name: 'Hammer', complexity_tier: 'Simple', signal_type: 'reversal',
  directional_bias: 'bullish', requires_gap: false, trend_context: 'prior-downtrend',
  mirror_pattern_name: 'Shooting Star',
};

describe('filterPatternsByMetadata', () => {
  test('throws NoFilterCriteriaError when no filter is given', async () => {
    await expect(svc.filterPatternsByMetadata()).rejects.toBeInstanceOf(svc.NoFilterCriteriaError);
    await expect(svc.filterPatternsByMetadata({})).rejects.toBeInstanceOf(svc.NoFilterCriteriaError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('always filters to active-only, resolves the mirror name via a self-join, and maps the row shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [METADATA_ROW] });

    const result = await svc.filterPatternsByMetadata({ signalType: 'reversal' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(`p.status = 'active'`);
    expect(sql).toContain('LEFT JOIN m_candlestick_pattern mirror ON mirror.id = p.mirror_pattern_id');
    expect(result).toEqual([{
      patternName: 'Hammer', complexityTier: 'Simple', signalType: 'reversal',
      directionalBias: 'bullish', requiresGap: false, trendContext: 'prior-downtrend',
      mirrorPatternName: 'Shooting Star',
    }]);
  });

  test('a name-or-synonym filter matches both pattern_name and the synonyms JSONB array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.filterPatternsByMetadata({ patternNameOrSynonym: 'pin bar' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.pattern_name ILIKE $1');
    expect(sql).toContain('p.synonyms::text ILIKE $1');
    expect(params).toEqual(['%pin bar%']);
  });

  test('a horizon filter uses the same unparameterized boolean-column approach as searchEntries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.filterPatternsByMetadata({ horizon: 'dayTrading' });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.is_day_trading = true');
    expect(params).toEqual([]);
  });

  test('combines multiple structural filters with correct parameter positions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.filterPatternsByMetadata({
      directionalBias: 'bearish', requiresGap: true, complexityTier: 'Advanced', trendContext: 'prior-uptrend',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.directional_bias = $1');
    expect(sql).toContain('p.complexity_tier = $2');
    expect(sql).toContain('p.requires_gap = $3');
    expect(sql).toContain('p.trend_context = $4');
    expect(params).toEqual(['bearish', 'Advanced', true, 'prior-uptrend']);
  });
});

describe('createPattern', () => {
  test('inserts the 3 boolean horizon columns plus the complexity tier, and returns the new pattern', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1', pattern_name: 'Doji', formation_description: 'desc', status: 'active',
        is_day_trading: true, is_medium_term: true, is_long_term: false, complexity_tier: 'Simple',
        created_at: 't1', updated_at: 't1',
      }],
    });

    const result = await svc.createPattern({
      patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading', 'mediumTerm'],
      complexityTier: 'Simple',
    });

    expect(result.patternName).toBe('Doji');
    expect(result.relevantHorizons).toEqual(['dayTrading', 'mediumTerm']);
    expect(result.complexityTier).toBe('Simple');
    expect(mockQuery.mock.calls[0][1]).toEqual(['Doji', 'desc', true, true, false, 'Simple']);
  });

  // complexity_tier (migration 050) is a per-pattern property, so a 3-candle pattern round-trips
  // its own tier rather than inheriting the column's 'Simple' default.
  test('round-trips a non-default complexity tier', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p2', pattern_name: 'Morning Star', formation_description: 'desc', status: 'active',
        is_day_trading: false, is_medium_term: true, is_long_term: true, complexity_tier: 'Advanced',
        created_at: 't1', updated_at: 't1',
      }],
    });

    const result = await svc.createPattern({
      patternName: 'Morning Star', formationDescription: 'desc', relevantHorizons: ['mediumTerm', 'longTerm'],
      complexityTier: 'Advanced',
    });

    expect(result.complexityTier).toBe('Advanced');
    expect(mockQuery.mock.calls[0][1]).toEqual(['Morning Star', 'desc', false, true, true, 'Advanced']);
  });

  test('maps a unique-violation into DuplicatePatternNameError', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });

    await expect(svc.createPattern({
      patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading'], complexityTier: 'Simple',
    })).rejects.toBeInstanceOf(svc.DuplicatePatternNameError);
  });
});

describe('createEntry', () => {
  test('defaults to Approved when no status is given (the admin/seed-authored path)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] }) // the INSERT ... RETURNING id
      .mockResolvedValueOnce({ rows: [ROW] }); // getEntryById's own SELECT

    await svc.createEntry({
      patternId: 'p1', category: 'Definition', tier: 101, questionText: 'Q', answerText: 'A', createdBy: 'u1',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['p1', 'Definition', 101, 'Q', 'A', 'Approved', 'u1']);
  });

  test('an explicit status (Phase 2\'s future promotion path) overrides the default', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
      .mockResolvedValueOnce({ rows: [ROW] });

    await svc.createEntry({
      patternId: 'p1', category: 'Definition', tier: 101, questionText: 'Q', answerText: 'A', createdBy: 'u1',
      status: 'Pending Approval',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[5]).toBe('Pending Approval');
  });
});

describe('setEntryStatus', () => {
  test('updates status/reviewed_by/reviewed_at', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await svc.setEntryStatus('e1', 'Approved', 'admin1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('reviewed_by = $2');
    expect(sql).toContain('reviewed_at = now()');
    expect(params).toEqual(['Approved', 'admin1', 'e1']);
  });

  test('throws EntryNotFoundError when no row matched', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    await expect(svc.setEntryStatus('missing', 'Rejected', 'admin1')).rejects.toBeInstanceOf(svc.EntryNotFoundError);
  });
});

// logQuestionAnswerEvent() and its tests were removed 2026-10-05 (Phase 2) - see
// candlestickQuestionAnswer.service.ts's own note at that old location, and
// candlestickAskedQuestion.service.test.ts / candlestickQuestionAnswerRateLimit.service.test.ts
// for what replaced it.
