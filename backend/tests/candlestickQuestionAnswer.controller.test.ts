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
}));
jest.mock('../src/services/candlestickQuestionTemplate.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionTemplate.service'),
  matchTemplate: jest.fn(),
  listTemplates: jest.fn(),
  createTemplate: jest.fn(),
  setTemplateStatus: jest.fn(),
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

import request from 'supertest';
import * as candlestickQuestionAnswer from '../src/services/candlestickQuestionAnswer.service';
import * as askService from '../src/services/candlestickQuestionAnswerAsk.service';
import * as rateLimitService from '../src/services/candlestickQuestionAnswerRateLimit.service';
import * as askedQuestionService from '../src/services/candlestickAskedQuestion.service';
import * as questionTemplateService from '../src/services/candlestickQuestionTemplate.service';
import * as rolesService from '../src/services/roles.service';
import * as userSubscription from '../src/services/userSubscription.service';
import { pool } from '../src/db/pool';
import { signToken } from '../src/services/auth.service';
import app from '../src/app';

const mockSearchEntries = candlestickQuestionAnswer.searchEntries as jest.Mock;
const mockCreatePattern = candlestickQuestionAnswer.createPattern as jest.Mock;
const mockCreateEntry = candlestickQuestionAnswer.createEntry as jest.Mock;
const mockSetEntryStatus = candlestickQuestionAnswer.setEntryStatus as jest.Mock;
const mockGetEntryById = candlestickQuestionAnswer.getEntryById as jest.Mock;
const mockAsk = askService.ask as jest.Mock;
const mockCheckRateLimit = rateLimitService.checkRateLimit as jest.Mock;
const mockRecordRateLimitedCall = rateLimitService.recordRateLimitedCall as jest.Mock;
const mockFindCachedAnswer = askedQuestionService.findCachedAnswer as jest.Mock;
const mockRecordAskedQuestion = askedQuestionService.recordAskedQuestion as jest.Mock;
const mockListTopQuestions = askedQuestionService.listTopQuestions as jest.Mock;
const mockMatchTemplate = questionTemplateService.matchTemplate as jest.Mock;
const mockListTemplates = questionTemplateService.listTemplates as jest.Mock;
const mockCreateTemplate = questionTemplateService.createTemplate as jest.Mock;
const mockSetTemplateStatus = questionTemplateService.setTemplateStatus as jest.Mock;
const mockGetUserPermissions = rolesService.getUserPermissions as jest.Mock;
const mockGetDecryptedKey = userSubscription.getDecryptedKey as jest.Mock;
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
  mockAsk.mockReset();
  mockCheckRateLimit.mockReset();
  mockRecordRateLimitedCall.mockReset().mockResolvedValue(undefined);
  mockFindCachedAnswer.mockReset().mockResolvedValue(null); // no cache hit by default
  mockRecordAskedQuestion.mockReset().mockResolvedValue(undefined);
  mockListTopQuestions.mockReset();
  mockMatchTemplate.mockReset();
  mockListTemplates.mockReset();
  mockCreateTemplate.mockReset();
  mockSetTemplateStatus.mockReset();
  mockGetUserPermissions.mockReset().mockResolvedValue(['candlestick_question_answer:ask', 'candlestick_question_answer:llm_calling']); // LLM-granted by default
  mockGetDecryptedKey.mockReset();
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
    const res = await request(app).get('/candlestick-question-answer/entries?horizon=dayTrading').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([{ id: 'e1', questionText: 'Q' }]);
    expect(mockSearchEntries).toHaveBeenCalledWith(expect.objectContaining({ horizon: 'dayTrading' }));
  });

  test('400 on an invalid horizon value', async () => {
    grantPermission();
    const res = await request(app).get('/candlestick-question-answer/entries?horizon=nonsense').set('Cookie', authCookie);
    expect(res.status).toBe(400);
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

  test('a cache hit answers directly - no permission check, no rate limit, no LLM, no template', async () => {
    grantPermission();
    mockFindCachedAnswer.mockResolvedValueOnce({ answerText: 'A Doji signals indecision.', matchedPatternNames: ['Doji'] });

    const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: [], matchedPatterns: ['Doji'], reason: null,
    });
    expect(mockGetUserPermissions).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockMatchTemplate).not.toHaveBeenCalled();
    expect(mockRecordAskedQuestion).not.toHaveBeenCalled();
  });

  describe('when llm_calling is granted', () => {
    test('429 when the rate limit is exceeded - the LLM is never called', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 10 });
      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });
      expect(res.status).toBe(429);
      expect(mockAsk).not.toHaveBeenCalled();
    });

    test('200 with the LLM\'s result, records the cache row and the rate-limit call, never touches templates', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 3 });
      mockGetDecryptedKey.mockResolvedValueOnce('test-anthropic-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: ['e1'], matchedPatternNames: [], reason: null,
        llmCallDetails: { llm_tokens_in: 100, llm_tokens_out: 20 },
      });
      mockGetEntryById.mockResolvedValueOnce({ id: 'e1', patternName: 'Doji' });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is a Doji?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'answered_from_kb', answer: 'A Doji signals indecision.', matchedEntryIds: ['e1'], matchedPatterns: ['Doji'], reason: null,
      });
      expect(mockRecordRateLimitedCall).toHaveBeenCalledWith('user-1');
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({
        questionText: 'What is a Doji?', horizon: 'dayTrading', answerText: 'A Doji signals indecision.',
        matchedPatternNames: ['Doji'], status: 'Answered',
      }));
      expect(mockGetDecryptedKey).toHaveBeenCalledWith('user-1', 'anthropic');
      expect(mockAsk).toHaveBeenCalledWith('What is a Doji?', 'dayTrading', 'test-anthropic-key');
      expect(mockMatchTemplate).not.toHaveBeenCalled();
    });

    test('an unable_to_answer LLM outcome is cached with status Unable_To_Answer', async () => {
      grantPermission();
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, exempt: false, limit: 10, windowMinutes: 10, usedInWindow: 0 });
      mockGetDecryptedKey.mockResolvedValueOnce('test-anthropic-key');
      mockAsk.mockResolvedValueOnce({
        outcome: 'unable_to_answer', answer: null, matchedEntryIds: [], matchedPatternNames: [],
        reason: 'Not covered.', llmCallDetails: { llm_tokens_in: 10, llm_tokens_out: 5 },
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
        llmCallDetails: { llm_tokens_in: 100, llm_tokens_out: 20 },
      });

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Which bullish continuation pattern needs a gap?', horizon: 'mediumTerm' });

      expect(res.status).toBe(200);
      expect(res.body.matchedPatterns).toEqual(['Upside Tasuki Gap']);
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

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'Is Hammer bullish or bearish?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'answered_from_kb', answer: 'Hammer is bullish.', matchedEntryIds: [], matchedPatterns: ['Hammer'], reason: null,
      });
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockRecordRateLimitedCall).not.toHaveBeenCalled();
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({ status: 'Answered', answerText: 'Hammer is bullish.' }));
    });

    test('no template match at all results in unable_to_answer, still cached as Unable_To_Answer', async () => {
      grantPermission();
      mockMatchTemplate.mockResolvedValueOnce(null);

      const res = await request(app).post('/candlestick-question-answer/ask').set('Cookie', authCookie).send({ question: 'What is the meaning of life?', horizon: 'dayTrading' });

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('unable_to_answer');
      expect(res.body.answer).toBeNull();
      expect(mockRecordAskedQuestion).toHaveBeenCalledWith(expect.objectContaining({ status: 'Unable_To_Answer', answerText: null, matchedPatternNames: [] }));
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
      { questionText: 'What is a Hammer?', answerText: 'A Hammer is bullish.', matchedPatternNames: ['Hammer'], questionAskedCount: 42, lastAskedAt: 't1' },
    ]);
    const res = await request(app).get('/candlestick-question-answer/top-questions').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].questionAskedCount).toBe(42);
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

  test('POST /templates - 201 on success', async () => {
    grantPermission();
    mockCreateTemplate.mockResolvedValueOnce({ id: 't1', templateKey: 'bias_lookup' });
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'bias_lookup', regexPattern: 'is (.+?) bullish or bearish', answerTemplate: '{patternName} is {directionalBias}.',
      responseMode: 'single', filterMapping: { fixedFilters: {}, groupFilters: { '1': 'patternNameOrSynonym' } },
    });
    expect(res.status).toBe(201);
  });

  test('POST /templates - 409 on a duplicate template key', async () => {
    grantPermission();
    const { DuplicateTemplateKeyError } = jest.requireActual('../src/services/candlestickQuestionTemplate.service');
    mockCreateTemplate.mockRejectedValueOnce(new DuplicateTemplateKeyError('duplicate'));
    const res = await request(app).post('/candlestick-question-answer/templates').set('Cookie', authCookie).send({
      templateKey: 'bias_lookup', regexPattern: 'x', answerTemplate: 'x', responseMode: 'single', filterMapping: { fixedFilters: {} },
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
