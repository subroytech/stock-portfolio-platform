jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/candlestickQuestionAnswer.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionAnswer.service'),
  filterPatternsByMetadata: jest.fn(),
}));

import { pool } from '../src/db/pool';
import * as candlestickQuestionAnswer from '../src/services/candlestickQuestionAnswer.service';
import type { PatternMetadataMatch } from '../src/services/candlestickQuestionAnswer.service';
import * as svc from '../src/services/candlestickQuestionTemplate.service';

const mockQuery = pool.query as unknown as jest.Mock;
const mockFilterPatternsByMetadata = candlestickQuestionAnswer.filterPatternsByMetadata as jest.Mock;

beforeEach(() => {
  mockQuery.mockReset();
  mockFilterPatternsByMetadata.mockReset();
});

const BIAS_LOOKUP_ROW = {
  id: 't1', regex_pattern: 'is (.+?) bullish or bearish\\??', response_mode: 'single',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
  answer_template: '{patternName} is {directionalBias}.',
};
const SIGNAL_TYPE_LIST_ROW = {
  id: 't2', regex_pattern: 'which patterns? (?:are|is) (reversal|continuation|indecision) signals?\\??', response_mode: 'list',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'signalType' } },
  answer_template: 'The {signalType} patterns are: {patternNameList}.',
};

const HAMMER_MATCH: PatternMetadataMatch = {
  patternName: 'Hammer', complexityTier: 'Simple', signalType: 'reversal', directionalBias: 'bullish',
  requiresGap: false, trendContext: 'prior-downtrend', mirrorPatternName: 'Shooting Star',
};

describe('matchTemplate', () => {
  test('returns null when no active template regex matches the question at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });

    const result = await svc.matchTemplate('What is the weather today?');

    expect(result).toBeNull();
    expect(mockFilterPatternsByMetadata).not.toHaveBeenCalled();
  });

  // horizon is no longer passed to filterPatternsByMetadata (2026-10-08) - it stopped being an
  // exclusionary filter; the controller annotates horizon relevance separately, after a match is
  // already resolved, via getPatternHorizonRelevance().
  test('a matching template extracts the capture group and calls filterPatternsByMetadata with it, without horizon', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

    const result = await svc.matchTemplate('Is Hammer bullish or bearish?');

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    expect(result).toEqual({ matches: [HAMMER_MATCH], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });
  });

  test('is case-insensitive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

    await svc.matchTemplate('IS HAMMER BULLISH OR BEARISH');

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'HAMMER' });
  });

  test('a regex match whose resolved filters find zero patterns still returns a (empty) result, not null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([]);

    const result = await svc.matchTemplate('Is Hamerr bullish or bearish?');

    expect(result).toEqual({ matches: [], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });
  });

  test('a fixed-filter-free list template maps its capture group to signalType', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SIGNAL_TYPE_LIST_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

    await svc.matchTemplate('Which patterns are reversal signals?');

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ signalType: 'reversal' });
  });

  test('only tests templates with status active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });

    await svc.matchTemplate('anything');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'active'`);
  });

  // Real bug found live (2026-10-08): patternNameOrSynonym's ILIKE '%...%' substring match
  // returns every pattern whose name CONTAINS the extracted text, not just an exact match - e.g.
  // "Doji" also matches "Doji-Dragonfly"/"Doji-Gravestone"/"Doji-LongLegged", silently breaking
  // 'single' mode's exactly-one-match requirement for a perfectly well-formed question.
  describe('single-mode name-collision narrowing', () => {
    const DOJI: PatternMetadataMatch = { ...HAMMER_MATCH, patternName: 'Doji' };
    const DOJI_DRAGONFLY: PatternMetadataMatch = { ...HAMMER_MATCH, patternName: 'Doji-Dragonfly' };

    test('narrows multiple substring matches down to the one exact (case-insensitive) name match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([DOJI, DOJI_DRAGONFLY]);

      const result = await svc.matchTemplate('Is doji bullish or bearish?');

      expect(result).toEqual({ matches: [DOJI], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });
    });

    test('leaves multiple matches alone (still fails single mode) when none is an exact name match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([DOJI_DRAGONFLY, { ...HAMMER_MATCH, patternName: 'Doji-Gravestone' }]);

      const result = await svc.matchTemplate('Is doji bullish or bearish?');

      expect(result!.matches).toHaveLength(2);
    });

    test('does not narrow list-mode results, even when the question happened to extract a name-like value', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [SIGNAL_TYPE_LIST_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([DOJI, DOJI_DRAGONFLY]);

      const result = await svc.matchTemplate('Which patterns are reversal signals?');

      expect(result!.matches).toHaveLength(2);
    });
  });
});

describe('formatTemplateAnswer', () => {
  test('single mode fills placeholders from the one match', () => {
    const answer = svc.formatTemplateAnswer({
      matches: [HAMMER_MATCH], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}, and {requiresGapText} need a gap.',
    });
    expect(answer).toBe('Hammer is bullish, and does not need a gap.');
  });

  test('single mode with zero matches returns null', () => {
    const answer = svc.formatTemplateAnswer({ matches: [], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });
    expect(answer).toBeNull();
  });

  test('single mode with more than one match returns null (too broad for a lookup shape)', () => {
    const answer = svc.formatTemplateAnswer({
      matches: [HAMMER_MATCH, { ...HAMMER_MATCH, patternName: 'Shooting Star' }],
      responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.',
    });
    expect(answer).toBeNull();
  });

  test('list mode joins every matching pattern name', () => {
    const answer = svc.formatTemplateAnswer({
      matches: [HAMMER_MATCH, { ...HAMMER_MATCH, patternName: 'Morning Star' }],
      responseMode: 'list', answerTemplate: 'The {signalType} patterns are: {patternNameList}.',
    });
    expect(answer).toBe('The reversal patterns are: Hammer, Morning Star.');
  });

  test('list mode with zero matches returns null', () => {
    const answer = svc.formatTemplateAnswer({ matches: [], responseMode: 'list', answerTemplate: 'The {signalType} patterns are: {patternNameList}.' });
    expect(answer).toBeNull();
  });

  test('an unrecognized placeholder is left untouched rather than throwing', () => {
    const answer = svc.formatTemplateAnswer({
      matches: [HAMMER_MATCH], responseMode: 'single', answerTemplate: '{patternName} has {bogusField}.',
    });
    expect(answer).toBe('Hammer has {bogusField}.');
  });
});

describe('createTemplate', () => {
  test('inserts the template, JSON-stringifying filterMapping', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BIAS_LOOKUP_ROW, template_key: 'bias_lookup', status: 'active', created_at: 't1', updated_at: 't1' }] });

    await svc.createTemplate({
      templateKey: 'bias_lookup', regexPattern: 'is (.+?) bullish or bearish\\??', responseMode: 'single',
      filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
      answerTemplate: '{patternName} is {directionalBias}.',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe(JSON.stringify({ fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } }));
  });

  test('maps a unique-violation into DuplicateTemplateKeyError', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });

    await expect(svc.createTemplate({
      templateKey: 'bias_lookup', regexPattern: 'x', responseMode: 'single',
      filterMapping: { fixedFilters: {}, groupFilters: {} }, answerTemplate: 'x',
    })).rejects.toBeInstanceOf(svc.DuplicateTemplateKeyError);
  });
});

describe('setTemplateStatus', () => {
  test('updates status and updated_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await svc.setTemplateStatus('t1', 'inactive');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('SET status = $1, updated_at = now()');
    expect(params).toEqual(['inactive', 't1']);
  });
});
