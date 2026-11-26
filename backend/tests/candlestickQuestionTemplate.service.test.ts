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

// regex_pattern here matches migration 064's own loosened value (2026-10-08) - "is" alone used
// to be the only accepted verb form, found live to miss a real "are" phrasing.
const BIAS_LOOKUP_ROW = {
  id: 't1', regex_pattern: '(?:is|are) (.+?) bullish or bearish\\??', response_mode: 'single',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
  answer_template: '{patternName} is {directionalBias}.',
};
const SIGNAL_TYPE_LIST_ROW = {
  id: 't2', regex_pattern: 'which patterns? (?:are|is) (reversal|continuation|indecision) signals?\\??', response_mode: 'list',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'signalType' } },
  answer_template: 'The {signalType} patterns are: {patternNameList}.',
};
// Migration 064's loosened mirror_lookup (2026-10-08) - "the" is now optional and "are" is
// accepted alongside "'s"/"is", found live via real variants of this template's own example
// phrasing that didn't match the original, stricter regex.
const MIRROR_LOOKUP_ROW = {
  id: 't3', regex_pattern: "what(?:'s| is| are)? ?(?:the )?(?:opposite|mirror) of (.+?)\\??$", response_mode: 'single',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
  answer_template: 'The mirror of {patternName} is {mirrorPatternName}.',
};
// Migration 064's loosened gap_requirement_lookup (2026-10-08) - the article "a" before "gap" is
// now optional.
const GAP_REQUIREMENT_LOOKUP_ROW = {
  id: 't4', regex_pattern: 'does (.+?) (?:require|need) a? ?gap\\??$', response_mode: 'single',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
  answer_template: '{patternName} {requiresGapText} require a gap.',
};

// Migration 068's broadened pattern_description - adds a 4th "what is X"/"what's X" branch
// (the single most natural phrasing, previously missing entirely) and a richer answer_template.
const PATTERN_DESCRIPTION_ROW = {
  id: 't5',
  regex_pattern: "(?:what does (.+?) mean|describe (.+?)|tell me about (.+?)|what(?:'s|\\s+is)\\s+(?:a\\s+|an\\s+|the\\s+)?(.+?))\\??$",
  response_mode: 'single',
  filter_mapping: {
    fixedFilters: {},
    groupFilters: { '1': 'patternNameOrSynonym', '2': 'patternNameOrSynonym', '3': 'patternNameOrSynonym', '4': 'patternNameOrSynonym' },
  },
  answer_template:
    '{patternName} is a {complexityTier}-candle {signalType} pattern with a {directionalBias} directional bias. '
    + 'It typically forms after {trendContext}, and {requiresGapText} require a gap to qualify. Its mirror pattern is {mirrorPatternName}.',
};
// Migration 068's new templates.
const COMPLEXITY_TIER_LOOKUP_ROW = {
  id: 't6', regex_pattern: '(?:what (?:complexity|tier) is (.+?)|how many candles does (.+?) (?:need|take|require))\\??$',
  response_mode: 'single',
  filter_mapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym', '2': 'patternNameOrSynonym' } },
  answer_template: '{patternName} is a {complexityTier} pattern.',
};
const TREND_UPTREND_LIST_ROW = {
  id: 't7', regex_pattern: 'which patterns? (?:need|require) (?:a |an )?(?:prior[- ]?)?uptrend\\??$',
  response_mode: 'list',
  filter_mapping: { fixedFilters: { trendContext: 'prior-uptrend' }, groupFilters: {} },
  answer_template: 'These patterns typically need a prior uptrend: {patternNameList}.',
};
const TREND_DOWNTREND_LIST_ROW = {
  id: 't8', regex_pattern: 'which patterns? (?:need|require) (?:a |an )?(?:prior[- ]?)?downtrend\\??$',
  response_mode: 'list',
  filter_mapping: { fixedFilters: { trendContext: 'prior-downtrend' }, groupFilters: {} },
  answer_template: 'These patterns typically need a prior downtrend: {patternNameList}.',
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

  test('bias_lookup also accepts "are" (migration 064)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BIAS_LOOKUP_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

    await svc.matchTemplate('Are Hammer bullish or bearish?');

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
  });

  // Real bug found live (2026-10-08): mirror_lookup's original regex hard-required the literal
  // word "the" and only accepted "is" - a user asking a real variant of this template's own
  // example phrasing ("What is opposite of X?" / "What are opposite of X?") got no match at all,
  // while only the canonical "What is THE opposite of X?" worked. Migration 064 makes "the"
  // optional and accepts "are" alongside "'s"/"is".
  describe('mirror_lookup grammar variants (migration 064)', () => {
    test('still matches the canonical phrasing with "the"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MIRROR_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('What is the opposite of Hammer?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('matches without "the"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MIRROR_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('What is opposite of Hammer?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('matches "are" without "the"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MIRROR_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('What are opposite of Hammer?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('still matches the "\'s" contraction', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MIRROR_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate("What's the mirror of Hammer?");

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });
  });

  test('gap_requirement_lookup matches without the article "a" (migration 064)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [GAP_REQUIREMENT_LOOKUP_ROW] });
    mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

    await svc.matchTemplate('Does Piercing Line require gap?');

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Piercing Line' });
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

  // Migration 068 - closes a real usability gap the user flagged directly: there was no
  // template at all for the single most natural phrasing, "What is <pattern>?".
  describe('pattern_description "what is X" phrasing (migration 068)', () => {
    test('matches "What is Hammer?"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PATTERN_DESCRIPTION_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('What is Hammer?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('matches "What\'s a Hammer?" (contraction + article)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PATTERN_DESCRIPTION_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate("What's a Hammer?");

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('matches "What is the Morning Star?" (multi-word pattern name + article)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PATTERN_DESCRIPTION_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([{ ...HAMMER_MATCH, patternName: 'Morning Star' }]);

      await svc.matchTemplate('What is the Morning Star?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Morning Star' });
    });

    // Collision guard: the new branch requires "'s"/"is" immediately (whitespace-only) after
    // "what", so a different shape that merely starts with "what" followed by other words first
    // must NOT be swallowed by this template - it has to fall through to its own, more specific
    // template (signal_type_lookup/trend_context_lookup in the real table, both with a higher id
    // than pattern_description so they're tried after it).
    test('does NOT match "What signal type is Hammer?" (belongs to signal_type_lookup)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PATTERN_DESCRIPTION_ROW] });

      const result = await svc.matchTemplate('What signal type is Hammer?');

      expect(result).toBeNull();
      expect(mockFilterPatternsByMetadata).not.toHaveBeenCalled();
    });

    test('does NOT match "What trend does Hammer need?" (belongs to trend_context_lookup)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [PATTERN_DESCRIPTION_ROW] });

      const result = await svc.matchTemplate('What trend does Hammer need?');

      expect(result).toBeNull();
      expect(mockFilterPatternsByMetadata).not.toHaveBeenCalled();
    });
  });

  // Migration 068 - complexity/candle-count lookup and the two directional trend_context list
  // templates.
  describe('new migration-068 templates', () => {
    test('complexity_tier_lookup matches "What complexity is Hammer?"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [COMPLEXITY_TIER_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('What complexity is Hammer?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('complexity_tier_lookup matches "How many candles does Hammer need?"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [COMPLEXITY_TIER_LOOKUP_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('How many candles does Hammer need?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ patternNameOrSynonym: 'Hammer' });
    });

    test('trend_uptrend_list maps to a fixed prior-uptrend filter, no capture group needed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [TREND_UPTREND_LIST_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('Which patterns need a prior uptrend?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ trendContext: 'prior-uptrend' });
    });

    test('trend_uptrend_list also matches without "prior" and with "an" instead of "a"', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [TREND_UPTREND_LIST_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('Which patterns need an uptrend?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ trendContext: 'prior-uptrend' });
    });

    test('trend_downtrend_list maps to a fixed prior-downtrend filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [TREND_DOWNTREND_LIST_ROW] });
      mockFilterPatternsByMetadata.mockResolvedValueOnce([HAMMER_MATCH]);

      await svc.matchTemplate('Which patterns require a prior-downtrend?');

      expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({ trendContext: 'prior-downtrend' });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ ...BIAS_LOOKUP_ROW, template_key: 'bias_lookup', example_phrasing: 'Is Hammer bullish or bearish?', status: 'active', created_at: 't1', updated_at: 't1' }] });

    await svc.createTemplate({
      templateKey: 'bias_lookup', regexPattern: 'is (.+?) bullish or bearish\\??', responseMode: 'single',
      filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
      answerTemplate: '{patternName} is {directionalBias}.',
      examplePhrasing: 'Is Hammer bullish or bearish?',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe(JSON.stringify({ fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } }));
    expect(params[5]).toBe('Is Hammer bullish or bearish?');
  });

  test('maps a unique-violation into DuplicateTemplateKeyError', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });

    await expect(svc.createTemplate({
      templateKey: 'bias_lookup', regexPattern: 'x', responseMode: 'single',
      filterMapping: { fixedFilters: {}, groupFilters: {} }, answerTemplate: 'x', examplePhrasing: 'x',
    })).rejects.toBeInstanceOf(svc.DuplicateTemplateKeyError);
  });
});

describe('listActiveExamplePhrasings', () => {
  test('returns only active templates\' example phrasings, in id order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ example_phrasing: 'Is Hammer bullish or bearish?' }, { example_phrasing: 'Which patterns are bullish?' }],
    });

    const result = await svc.listActiveExamplePhrasings();

    expect(result).toEqual(['Is Hammer bullish or bearish?', 'Which patterns are bullish?']);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'active'`);
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
