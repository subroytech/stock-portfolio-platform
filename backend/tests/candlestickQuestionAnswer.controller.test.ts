// This file's 37+ requests all share one hardcoded authCookie/user id, so they'd otherwise all
// accumulate against the same real per-user express-rate-limit bucket (RATE_LIMIT_MAX_PER_USER,
// default 30) and start 429ing partway through the file - a test-infra concern unrelated to
// anything this file is actually testing, so the real rate-limit middleware is neutralized here.
jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: jest.fn(),
}));
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../src/services/candlestickQuestionAnswer.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionAnswer.service'),
  searchEntries: jest.fn(),
  listPatterns: jest.fn(),
  createPattern: jest.fn(),
  listAllEntries: jest.fn(),
  createEntry: jest.fn(),
  setEntryStatus: jest.fn(),
  getEntryById: jest.fn(),
  getPatternHorizonRelevance: jest.fn(),
}));
jest.mock('../src/services/candlestickQuestionAnswerAsk.service', () => ({ ask: jest.fn() }));
jest.mock('../src/services/candlestickQuestionAnswerRateLimit.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionAnswerRateLimit.service'),
  checkRateLimit: jest.fn(),
  recordRateLimitedCall: jest.fn(),
}));
jest.mock('../src/services/candlestickAskedQuestion.service', () => ({
  ...jest.requireActual('../src/services/candlestickAskedQuestion.service'),
  findCachedAnswer: jest.fn(),
  recordAskedQuestion: jest.fn(),
  listTopQuestions: jest.fn(),
  deleteAskedQuestion: jest.fn(),
}));
jest.mock('../src/services/candlestickQuestionTemplate.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionTemplate.service'),
  matchTemplate: jest.fn(),
  listTemplates: jest.fn(),
  createTemplate: jest.fn(),
  setTemplateStatus: jest.fn(),
  listActiveExamplePhrasings: jest.fn(),
}));
jest.mock('../src/services/roles.service', () => ({
  ...jest.requireActual('../src/services/roles.service'),
  getUserPermissions: jest.fn(),
}));
jest.mock('../src/services/usageTracking.service', () => ({ logUsage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/userSubscription.service', () => ({
  ...jest.requireActual('../src/services/userSubscription.service'),
  getDecryptedKey: jest.fn(),
}));
jest.mock('../src/services/configProperty.service', () => ({ getConfigValue: jest.fn() }));

import request from 'supertest';
import * as candlestickQuestionAnswer from '../src/services/candlestickQuestionAnswer.service';
import * as askService from '../src/services/candlestickQuestionAnswerAsk.service';
import * as rateLimitService from '../src/services/candlestickQuestionAnswerRateLimit.service';
import * as askedQuestionService from '../src/services/candlestickAskedQuestion.service';
import * as questionTemplateService from '../src/services/candlestickQuestionTemplate.service';
import * as rolesService from '../src/services/roles.service';
import * as userSubscription from '../src/services/userSubscription.service';
import * as configProperty from '../src/services/configProperty.service';
import { pool } from '../src/db/pool';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockSearchEntries = candlestickQuestionAnswer.searchEntries as jest.Mock;
const mockCreatePattern = candlestickQuestionAnswer.createPattern as jest.Mock;
const mockCreateEntry = candlestickQuestionAnswer.createEntry as jest.Mock;
const mockSetEntryStatus = candlestickQuestionAnswer.setEntryStatus as jest.Mock;
const mockGetEntryById = candlestickQuestionAnswer.getEntryById as jest.Mock;
const mockGetPatternHorizonRelevance = candlestickQuestionAnswer.getPatternHorizonRelevance as jest.Mock;
const mockAsk = askService.ask as jest.Mock;
const mockCheckRateLimit = rateLimitService.checkRateLimit as jest.Mock;
const mockRecordRateLimitedCall = rateLimitService.recordRateLimitedCall as jest.Mock;
const mockFindCachedAnswer = askedQuestionService.findCachedAnswer as jest.Mock;
const mockRecordAskedQuestion = askedQuestionService.recordAskedQuestion as jest.Mock;
const mockListTopQuestions = askedQuestionService.listTopQuestions as jest.Mock;
const mockDeleteAskedQuestion = askedQuestionService.deleteAskedQuestion as jest.Mock;
const mockMatchTemplate = questionTemplateService.matchTemplate as jest.Mock;
const mockListTemplates = questionTemplateService.listTemplates as jest.Mock;
const mockCreateTemplate = questionTemplateService.createTemplate as jest.Mock;
const mockSetTemplateStatus = questionTemplateService.setTemplateStatus as jest.Mock;
const mockListActiveExamplePhrasings = questionTemplateService.listActiveExamplePhrasings as jest.Mock;
const mockGetUserPermissions = rolesService.getUserPermissions as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
const mockGetConfigValue = configProperty.getConfigValue as jest.Mock;
const mockQuery = pool.query as unknown as jest.Mock;

const authCookie = `auth_token=${signToken('user-1')}`;

// requirePermission queries pool.query directly - a truthy row means "has this permission."
function grantPermission() { mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] }); }
function denyPermission() { mockQuery.mockResolvedValue({ rows: [] }); }

beforeEach(() => {
  mockSearchEntries.mockReset();
  mockCreatePattern.mockReset();
  mockCreateEntry.mockReset();
  mockSetEntryStatus.mockReset();
  mockGetEntryById.mockReset();
  // Default: every pattern name maps to "nothing to say" (null) unless a test configures a real
  // relevance map - matches getPatternHorizonRelevance's own real behavior for an unrecognized
  // name, and keeps tests that don't care about relevance values uncluttered.
  mockGetPatternHorizonRelevance.mockReset().mockResolvedValue({});
  mockAsk.mockReset();
  mockCheckRateLimit.mockReset();
  mockRecordRateLimitedCall.mockReset().mockResolvedValue(undefined);
  mockFindCachedAnswer.mockReset().mockResolvedValue(null); // no cache hit by default
  mockRecordAskedQuestion.mockReset().mockResolvedValue(undefined);
  mockListTopQuestions.mockReset();
  mockDeleteAskedQuestion.mockReset();
  mockMatchTemplate.mockReset();
  mockListTemplates.mockReset();
  mockCreateTemplate.mockReset();
  mockSetTemplateStatus.mockReset();
  mockListActiveExamplePhrasings.mockReset();
  mockGetUserPermissions.mockReset().mockResolvedValue(['candlestick_question_answer:ask', 'candlestick_question_answer:llm_calling']); // LLM-granted by default
  mockGetDecryptedKey.mockReset();
  mockGetConfigValue.mockReset().mockResolvedValue(null); // falls back to 'anthropic'
  mockQuery.mockReset();
});

describe('GET /candlestick-question-answer/entries', () => {
  test('403 without candlestick_question_answer:ask', async () => {
    denyPermission();
    const res = await request(app).get('/candlestick-question-answer/entries').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockSearchEntries).not.toHaveBeenCalled();
  });

  test('200 with the permission, returning curated entries', async () => {
    grantPermission();
    mockSearchEntries.mockResolvedValueOnce([{ id: 'e1', questionText: 'Q' }]);
    const res = await request(app).get('/candlestick-question-answer/entries?query=doji').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([{ id: 'e1', questionText: 'Q' }]);
    expect(mockSearchEntries).toHaveBeenCalledWith({ query: 'doji', tier: undefined });
  });
});

describe('POST /candlestick-question-answer/ask', () => {
  test('400 when question is missing', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ horizon: 'dayTrading' });
    expect(res.status).toBe(400);
    expect(mockFindCachedAnswer).not.toHaveBeenCalled();
  });

  test('400 on an invalid horizon', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'nonsense' });
    expect(res.status).toBe(400);
  });

  test('a cache hit under the SAME horizon it was stored under answers directly, with no re-enrichment', async () => {
    grantPermission();
    // The cache row already carries its enriched shape from when it was first written, under
    // the same horizon this request is using - a hit replays it verbatim, never re-calling
    // getPatternHorizonRelevance (2026-10-10: horizon dropped out of the cache lookup key
    // itself, but the controller still skips re-enrichment when the stored horizon matches).
    mockFindCachedAnswer.mockResolvedValueOnce({
      answerText: 'A Doji signals indecision.', matchedPatternNames: [{ patternName: 'Doji', relevantForHorizon: true }], resolvedVia: 'llm', fromGeneralKnowledge: true, horizon: 'dayTrading',
    });

    const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: [],
      matchedPatterns: [{ patternName: 'Doji', relevantForHorizon: true }], reason: null, resolvedVia: 'llm', fromGeneralKnowledge: true,
    });
    expect(mockGetUserPermissions).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockMatchTemplate).not.toHaveBeenCalled();
    expect(mockRecordAskedQuestion).not.toHaveBeenCalled();
    expect(mockGetPatternHorizonRelevance).not.toHaveBeenCalled();
  });

  test('a cache hit under a DIFFERENT horizon than it was stored under re-enriches the relevance badges fresh (2026-10-10)', async () => {
    grantPermission();
    // The row was originally written under 'dayTrading' (and would have shown a green badge for
    // that horizon) - this request asks under 'longTerm' instead, so the stale 'dayTrading'
    // badge must not be blindly replayed; it has to be recomputed for 'longTerm'.
    mockFindCachedAnswer.mockResolvedValueOnce({
      answerText: 'A Doji signals indecision.', matchedPatternNames: [{ patternName: 'Doji', relevantForHorizon: true }], resolvedVia: 'llm', fromGeneralKnowledge: true, horizon: 'dayTrading',
    });
    mockGetPatternHorizonRelevance.mockResolvedValueOnce({ Doji: false });

    const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'longTerm' });

    expect(res.status).toBe(200);
    expect(res.body.matchedPatterns).toEqual([{ patternName: 'Doji', relevantForHorizon: false }]);
    expect(mockGetPatternHorizonRelevance).toHaveBeenCalledWith(['Doji'], 'longTerm');
    expect(mockRecordAskedQuestion).not.toHaveBeenCalled(); // still a cache hit - never re-written
  });

  describe('when llm_calling is granted', () => {
    test('429 when the rate limit is exceeded - the LLM is never called', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 10 });
      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });
      expect(res.status).toBe(429);
      expect(mockAsk).not.toHaveBeenCalled();
    });

    test('200 with the LLM\'s result when no template matches first, records the cache row and the rate-limit call', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce(null);
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
      mockGetDecryptedKey.mockResolvedValueOnce('test-anthropic-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: ['e1'], matchedPatternNames: [], reason: null,
        llmCallDetails: { llm_tokens_in: 100, llm_tokens_out: 20 }, fromGeneralKnowledge: false,
      });
      mockGetEntryById.mockResolvedValueOnce({ id: 'e1', patternName: 'Doji' });
      mockGetPatternHorizonRelevance.mockResolvedValueOnce({ Doji: false });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: ['e1'],
        matchedPatterns: [{ patternName: 'Doji', relevantForHorizon: false }], reason: null, resolvedVia: 'llm', fromGeneralKnowledge: false,
      });
      expect(mockGetPatternHorizonRelevance).toHaveBeenCalledWith(['Doji'], 'dayTrading');
      expect(mockRecordRateLimitedCall).toHaveBeenCalledWith('user-1');
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({
        questionText: 'What is a Doji?', horizon: 'dayTrading', answerText: 'A Doji signals indecision.',
        matchedPatternNames: [{ patternName: 'Doji', relevantForHorizon: false }], status: 'Answered', resolvedVia: 'llm', fromGeneralKnowledge: false,
      }));
      expect(mockGetDecryptedKey).toHaveBeenCalledWith('user-1', 'anthropic');
      expect(mockAsk).toHaveBeenCalledWith('What is a Doji?', 'dayTrading', 'test-anthropic-key', 'anthropic');
      expect(mockMatchTemplate).toHaveBeenCalledWith('What is a Doji?');
    });

    test('when the Config Property selects openai, fetches the openai key and threads it through to ask()', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce(null);
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
      mockGetConfigValue.mockResolvedValueOnce('openai');
      mockGetDecryptedKey.mockResolvedValueOnce('test-openai-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: [], matchedPatternNames: [], reason: null,
        llmCallDetails: { llm_tokens_in: 100, llm_tokens_out: 20 }, fromGeneralKnowledge: false,
      });

      await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

      expect(mockGetDecryptedKey).toHaveBeenCalledWith('user-1', 'openai');
      expect(mockAsk).toHaveBeenCalledWith('What is a Doji?', 'dayTrading', 'test-openai-key', 'openai');
    });

    // Real bug found live (2026-10-08): llm_calling previously routed straight to the LLM branch,
    // skipping the template cascade entirely - a premium/LLM-enabled role got a WORSE outcome than
    // a non-premium role for the exact same question whenever the LLM branch itself failed (e.g.
    // no Anthropic key configured anywhere), since it never got a chance to fall back to a
    // template that would have answered the question for free. Reordered so templates are tried
    // first for every role, LLM only when nothing deterministic matched.
    test('a template match answers directly even when llm_calling is granted - the LLM is never called', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce({
        matches: [{ patternName: 'Hammer', complexityTier: 'Simple', signalType: 'reversal', directionalBias: 'bullish', requiresGap: false, trendContext: 'prior-downtrend', mirrorPatternName: 'Shooting Star' }],
        responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.',
      });
      mockGetPatternHorizonRelevance.mockResolvedValueOnce({ Hammer: true });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Is Hammer bullish or bearish?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'answered_from_kb', answer: 'Hammer is bullish.', matchedEntryIds: [],
        matchedPatterns: [{ patternName: 'Hammer', relevantForHorizon: true }], reason: null, resolvedVia: 'template', fromGeneralKnowledge: false,
      });
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockGetDecryptedKey).not.toHaveBeenCalled();
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    test('an unable_to_answer LLM outcome is cached with status Unable_To_Answer', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 0 });
      mockGetDecryptedKey.mockResolvedValueOnce('test-anthropic-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'unable_to_answer', answer: null, matchedEntryIds: [], matchedPatternNames: [],
        reason: 'Not covered.', llmCallDetails: { llm_tokens_in: 10, llm_tokens_out: 5 }, fromGeneralKnowledge: false,
      });

      await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'An obscure question', horizon: 'dayTrading' });

      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({ status: 'Unable_To_Answer', answerText: null }));
    });

    test('200 with a purely-structural answer - matchedPatterns comes from matchedPatternNames when there are no entry_ids', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
      mockGetDecryptedKey.mockResolvedValueOnce('test-anthropic-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'answered_from_kb', answer: 'Upside Tasuki Gap is bullish and needs a gap.',
        matchedEntryIds: [], matchedPatternNames: ['Upside Tasuki Gap'], reason: null,
        llmCallDetails: { llm_tokens_in: 100, llm_tokens_out: 20 }, fromGeneralKnowledge: false,
      });

      mockGetPatternHorizonRelevance.mockResolvedValueOnce({ 'Upside Tasuki Gap': true });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Which bullish continuation pattern needs a gap?', horizon: 'mediumTerm' });

      expect(res.status).toBe(200);
      expect(res.body.matchedPatterns).toEqual([{ patternName: 'Upside Tasuki Gap', relevantForHorizon: true }]);
      // No entry ids resolved, so getEntryById is never called.
      expect(mockGetEntryById).not.toHaveBeenCalled();
    });

    test('503 when the user has no anthropic API key on file - the LLM is never called', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 0 });
      mockGetDecryptedKey.mockRejectedValueOnce(new userSubscription.MissingUserApiKeyError('No anthropic API key on file. Add one via PUT /subscriptions/anthropic.'));

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('No anthropic API key on file. Add one via PUT /subscriptions/anthropic.');
      expect(mockAsk).not.toHaveBeenCalled();
    });
  });

  describe('when llm_calling is NOT granted', () => {
    beforeEach(() => {
      mockGetUserPermissions.mockResolvedValue(['candlestick_question_answer:ask']); // ask only, no llm_calling
    });

    test('a matched template answers directly - no rate limit check, no LLM call at all', async () => {
      grantPermission();
      const hammerMatch = {
        patternName: 'Hammer', complexityTier: 'Simple', signalType: 'reversal', directionalBias: 'bullish',
        requiresGap: false, trendContext: 'prior-downtrend', mirrorPatternName: 'Shooting Star',
      };
      mockMatchTemplate.mockResolvedValueOnce({ matches: [hammerMatch], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });
      mockGetPatternHorizonRelevance.mockResolvedValueOnce({ Hammer: true });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Is Hammer bullish or bearish?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'answered_from_kb', answer: 'Hammer is bullish.', matchedEntryIds: [],
        matchedPatterns: [{ patternName: 'Hammer', relevantForHorizon: true }], reason: null, resolvedVia: 'template', fromGeneralKnowledge: false,
      });
      expect(mockGetPatternHorizonRelevance).toHaveBeenCalledWith(['Hammer'], 'dayTrading');
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockRecordRateLimitedCall).not.toHaveBeenCalled();
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({
        status: 'Answered', answerText: 'Hammer is bullish.',
        matchedPatternNames: [{ patternName: 'Hammer', relevantForHorizon: true }],
      }));
    });

    test('no template match at all results in unable_to_answer, still cached as Unable_To_Answer', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce(null);

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is the meaning of life?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('unable_to_answer');
      expect(res.body.answer).toBeNull();
      expect(res.body.resolvedVia).toBe('none');
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({ status: 'Unable_To_Answer', answerText: null, matchedPatternNames: [], resolvedVia: 'none' }));
    });

    test('a template shape match whose filters resolve to zero patterns also results in unable_to_answer', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce({ matches: [], responseMode: 'single', answerTemplate: '{patternName} is {directionalBias}.' });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Is Hamerr bullish or bearish?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('unable_to_answer');
    });
  });
});

describe('admin content management', () => {
  test('POST /patterns - 403 without candlestick_question_answer:manage_content', async () => {
    denyPermission();
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie).send({ patternName: 'Doji', formationDescription: 'desc' });
    expect(res.status).toBe(403);
  });

  test('POST /patterns - 201 with the permission', async () => {
    grantPermission();
    mockCreatePattern.mockResolvedValueOnce({ id: 'p1', patternName: 'Doji' });
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading', 'mediumTerm'], complexityTier: 'Simple' });
    expect(res.status).toBe(201);
  });

  test('POST /patterns - 400 when complexityTier is missing', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading'] });
    expect(res.status).toBe(400);
    expect(mockCreatePattern).not.toHaveBeenCalled();
  });

  test('POST /patterns - 400 when complexityTier is not a real tier', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading'], complexityTier: 'Expert' });
    expect(res.status).toBe(400);
    expect(mockCreatePattern).not.toHaveBeenCalled();
  });

  test('POST /patterns - 400 when relevantHorizons is missing or empty', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: [] });
    expect(res.status).toBe(400);
    expect(mockCreatePattern).not.toHaveBeenCalled();
  });

  test('POST /patterns - 400 when relevantHorizons contains an invalid value', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading', 'notAHorizon'] });
    expect(res.status).toBe(400);
    expect(mockCreatePattern).not.toHaveBeenCalled();
  });

  test('POST /patterns - 409 on a duplicate name', async () => {
    grantPermission();
    const { DuplicatePatternNameError } = jest.requireActual('../src/services/candlestickQuestionAnswer.service');
    mockCreatePattern.mockRejectedValueOnce(new DuplicatePatternNameError('dup'));
    const res = await request(app).post('/candlestick-question-answer/patterns').set('Cookie', authCookie)
      .send({ patternName: 'Doji', formationDescription: 'desc', relevantHorizons: ['dayTrading'], complexityTier: 'Simple' });
    expect(res.status).toBe(409);
  });

  test('POST /entries - 400 on an invalid tier', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/entries').set('Cookie', authCookie)
      .send({ patternId: 'p1', category: 'Definition', tier: 999, questionText: 'Q', answerText: 'A' });
    expect(res.status).toBe(400);
    expect(mockCreateEntry).not.toHaveBeenCalled();
  });

  test('POST /entries - 400 on an invalid category', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/entries').set('Cookie', authCookie)
      .send({ patternId: 'p1', category: 'NotACategory', tier: 101, questionText: 'Q', answerText: 'A' });
    expect(res.status).toBe(400);
    expect(mockCreateEntry).not.toHaveBeenCalled();
  });

  test('POST /entries - 201 on success', async () => {
    grantPermission();
    mockCreateEntry.mockResolvedValueOnce({ id: 'e1' });
    const res = await request(app).post('/candlestick-question-answer/entries').set('Cookie', authCookie)
      .send({ patternId: 'p1', category: 'Definition', tier: 101, questionText: 'Q', answerText: 'A' });
    expect(res.status).toBe(201);
  });

  test('PUT /entries/:id/status - 400 on an invalid status value', async () => {
    grantPermission();
    const res = await request(app).put('/candlestick-question-answer/entries/e1/status').set('Cookie', authCookie).send({ status: 'Bogus' });
    expect(res.status).toBe(400);
    expect(mockSetEntryStatus).not.toHaveBeenCalled();
  });

  test('PUT /entries/:id/status - 404 when the entry does not exist', async () => {
    grantPermission();
    const { EntryNotFoundError } = jest.requireActual('../src/services/candlestickQuestionAnswer.service');
    mockSetEntryStatus.mockRejectedValueOnce(new EntryNotFoundError('missing'));
    const res = await request(app).put('/candlestick-question-answer/entries/missing/status').set('Cookie', authCookie).send({ status: 'Approved' });
    expect(res.status).toBe(404);
  });

  test('PUT /entries/:id/status - 200 on success', async () => {
    grantPermission();
    mockSetEntryStatus.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/candlestick-question-answer/entries/e1/status').set('Cookie', authCookie).send({ status: 'Approved' });
    expect(res.status).toBe(200);
  });
});

describe('GET /candlestick-question-answer/top-questions', () => {
  test('403 without candlestick_question_answer:ask', async () => {
    denyPermission();
    const res = await request(app).get('/candlestick-question-answer/top-questions').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the permission, returning the ranked list', async () => {
    grantPermission();
    mockListTopQuestions.mockResolvedValueOnce([
      {
        id: 'q1', questionText: 'What is a Hammer?', answerText: 'A Hammer is bullish.',
        matchedPatternNames: [{ patternName: 'Hammer', relevantForHorizon: true }], questionAskedCount: 42, lastAskedAt: 't1',
        resolvedVia: 'template', fromGeneralKnowledge: false,
      },
    ]);
    const res = await request(app).get('/candlestick-question-answer/top-questions').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].questionAskedCount).toBe(42);
  });
});

describe('DELETE /candlestick-question-answer/top-questions/:id', () => {
  test('403 without candlestick_question_answer:delete_history', async () => {
    denyPermission();
    const res = await request(app).delete('/candlestick-question-answer/top-questions/q1').set('Cookie', authCookie);
    expect(res.status).toBe(403);
    expect(mockDeleteAskedQuestion).not.toHaveBeenCalled();
  });

  test('200 with the permission, deleting the row by id', async () => {
    grantPermission();
    mockDeleteAskedQuestion.mockResolvedValueOnce(true);
    const res = await request(app).delete('/candlestick-question-answer/top-questions/q1').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDeleteAskedQuestion).toHaveBeenCalledWith('q1');
  });

  test('404 when no row matched the given id', async () => {
    grantPermission();
    mockDeleteAskedQuestion.mockResolvedValueOnce(false);
    const res = await request(app).delete('/candlestick-question-answer/top-questions/bogus').set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /candlestick-question-answer/question-shapes', () => {
  test('403 without candlestick_question_answer:ask', async () => {
    denyPermission();
    const res = await request(app).get('/candlestick-question-answer/question-shapes').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('200 with the permission, returning only the example phrasings', async () => {
    grantPermission();
    mockListActiveExamplePhrasings.mockResolvedValueOnce(['Is Hammer bullish or bearish?', 'Which patterns are bullish?']);
    const res = await request(app).get('/candlestick-question-answer/question-shapes').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.examples).toEqual(['Is Hammer bullish or bearish?', 'Which patterns are bullish?']);
  });
});

describe('Question Templates admin management', () => {
  test('GET /templates - 403 without candlestick_question_answer:manage_content', async () => {
    denyPermission();
    const res = await request(app).get('/candlestick-question-answer/templates').set('Cookie', authCookie);
    expect(res.status).toBe(403);
  });

  test('GET /templates - 200 with the permission', async () => {
    grantPermission();
    mockListTemplates.mockResolvedValueOnce([{ id: 't1', templateKey: 'bias_lookup' }]);
    const res = await request(app).get('/candlestick-question-answer/templates').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([{ id: 't1', templateKey: 'bias_lookup' }]);
  });

  test('POST /templates - 400 when required fields are missing', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({ templateKey: 'x' });
    expect(res.status).toBe(400);
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  test('POST /templates - 400 when responseMode is not single/list', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'x', regexPattern: 'x', answerTemplate: 'x', responseMode: 'bogus', filterMapping: { fixedFilters: {} },
    });
    expect(res.status).toBe(400);
  });

  test('POST /templates - 400 when examplePhrasing is missing', async () => {
    grantPermission();
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'x', regexPattern: 'x', answerTemplate: 'x', responseMode: 'single', filterMapping: { fixedFilters: {} },
    });
    expect(res.status).toBe(400);
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  test('POST /templates - 201 on success', async () => {
    grantPermission();
    mockCreateTemplate.mockResolvedValueOnce({ id: 't1', templateKey: 'bias_lookup' });
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'bias_lookup', regexPattern: 'is (.+?) bullish or bearish', answerTemplate: '{patternName} is {directionalBias}.',
      responseMode: 'single', filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
      examplePhrasing: 'Is Hammer bullish or bearish?',
    });
    expect(res.status).toBe(201);
  });

  test('POST /templates - 409 on a duplicate template key', async () => {
    grantPermission();
    const { DuplicateTemplateKeyError } = jest.requireActual('../src/services/candlestickQuestionTemplate.service');
    mockCreateTemplate.mockRejectedValueOnce(new DuplicateTemplateKeyError('duplicate'));
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'bias_lookup', regexPattern: 'x', answerTemplate: 'x', responseMode: 'single', filterMapping: { fixedFilters: {} },
      examplePhrasing: 'x',
    });
    expect(res.status).toBe(409);
  });

  test('PUT /templates/:id/status - 400 on an invalid status value', async () => {
    grantPermission();
    const res = await request(app).put('/candlestick-question-answer/templates/t1/status').set('Cookie', authCookie).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('PUT /templates/:id/status - 200 on success', async () => {
    grantPermission();
    mockSetTemplateStatus.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/candlestick-question-answer/templates/t1/status').set('Cookie', authCookie).send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(mockSetTemplateStatus).toHaveBeenCalledWith('t1', 'inactive');
  });
});
