import { Request, Response, NextFunction } from 'express';
import * as candlestickQuestionAnswer from '../services/candlestickQuestionAnswer.service';
import type { Horizon, Tier, Category, ComplexityTier } from '../services/candlestickQuestionAnswer.service';
import * as ask from '../services/candlestickQuestionAnswerAsk.service';
import { checkRateLimit, recordRateLimitedCall, CandlestickQuestionAnswerRateLimitExceededError } from '../services/candlestickQuestionAnswerRateLimit.service';
import * as askedQuestion from '../services/candlestickAskedQuestion.service';
import * as questionTemplate from '../services/candlestickQuestionTemplate.service';
import * as rolesService from '../services/roles.service';
import * as usageTracking from '../services/usageTracking.service';
import * as userSubscription from '../services/userSubscription.service';

const LLM_CALLING_PERMISSION = 'candlestick_question_answer:llm_calling';

const VALID_HORIZONS: Horizon[] = ['dayTrading', 'mediumTerm', 'longTerm', 'all'];
const VALID_TIERS: Tier[] = [101, 201, 301];
const VALID_CATEGORIES: Category[] = ['Definition', 'Interpretation', 'Reliability', 'How to Use', 'Common Mistakes'];
const VALID_COMPLEXITY_TIERS: ComplexityTier[] = ['Simple', 'Composite', 'Advanced', 'Complex'];

// This route sits behind requireAuth (see app.ts), so req.user is always populated here.
function getUserId(req: Request): string {
  if (!req.user) throw new Error('getUserId called on an unauthenticated request — is this route missing requireAuth?');
  return req.user.id;
}

function parseHorizon(raw: unknown): Horizon | null {
  return typeof raw === 'string' && (VALID_HORIZONS as string[]).includes(raw) ? (raw as Horizon) : null;
}

function parseTier(raw: unknown): Tier | undefined {
  const n = Number(raw);
  return (VALID_TIERS as number[]).includes(n) ? (n as Tier) : undefined;
}

function parseCategory(raw: unknown): Category | null {
  return typeof raw === 'string' && (VALID_CATEGORIES as string[]).includes(raw) ? (raw as Category) : null;
}

function parseComplexityTier(raw: unknown): ComplexityTier | null {
  return typeof raw === 'string' && (VALID_COMPLEXITY_TIERS as string[]).includes(raw) ? (raw as ComplexityTier) : null;
}

// A pattern's own relevant-horizons list (migration 048) - at least one required, every element
// must be a real Horizon value.
function parseRelevantHorizons(raw: unknown): Horizon[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((h) => typeof h === 'string' && (VALID_HORIZONS as string[]).includes(h))) return null;
  return raw as Horizon[];
}

// The curated picker's own read - zero LLM cost, ungated by any rate limit (same "reads stay
// free" precedent used everywhere else in this app). `horizon`/`tier`/`query` are all optional.
export async function searchEntries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entries = await candlestickQuestionAnswer.searchEntries({
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      tier: req.query.tier ? parseTier(req.query.tier) : undefined,
    });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
}

// Tags each matched pattern name with whether it's actually relevant to the requested horizon
// (2026-10-08) - null when horizon is 'all' (nothing to compare against) or a name somehow has
// no matching row. Called once per fresh resolution (LLM or template); a cache hit skips this
// entirely and replays the already-enriched shape stored on the row, since the cache is keyed
// per (question, horizon) - a hit's stored horizon always equals the current request's.
async function enrichMatchedPatterns(
  patternNames: string[], horizon: Horizon,
): Promise<{ patternName: string; relevantForHorizon: boolean | null }[]> {
  const relevance = await candlestickQuestionAnswer.getPatternHorizonRelevance(patternNames, horizon);
  return patternNames.map((patternName) => ({ patternName, relevantForHorizon: relevance[patternName] ?? null }));
}

// The free-text ask path - a deterministic-first resolution cascade (Phase 2, 2026-10-05):
// 1. A cache hit (m_candlestick_asked_question) answers directly - no LLM, no rate limit, no
//    template logic reached at all.
// 2. A role holding candlestick_question_answer:llm_calling falls to the existing Phase 1 ReAct
//    loop (the only branch that is rate-limited and costs a real, billed LLM call).
// 3. A role without that permission falls to the deterministic question-template cascade
//    instead - never the LLM. No match there means 'unable_to_answer', the end of the line.
// Every outcome (success or not) is written to the cache so a repeat ask of the same question,
// from anyone, becomes a free cache hit from then on.
export async function askQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const horizon = parseHorizon(req.body?.horizon);
  if (!question) {
    res.status(400).json({ error: 'A question is required.' });
    return;
  }
  if (!horizon) {
    res.status(400).json({ error: `horizon must be one of: ${VALID_HORIZONS.join(', ')}` });
    return;
  }

  try {
    const userId = getUserId(req);

    const cached = await askedQuestion.findCachedAnswer(question, horizon);
    if (cached) {
      res.json({
        outcome: 'answered_from_kb',
        answer: cached.answerText,
        matchedEntryIds: [],
        matchedPatterns: cached.matchedPatternNames,
        reason: null,
      });
      return;
    }

    const permissions = await rolesService.getUserPermissions(userId);
    if (permissions.includes(LLM_CALLING_PERMISSION)) {
      const rateLimit = await checkRateLimit(userId);
      if (!rateLimit.allowed) {
        throw new CandlestickQuestionAnswerRateLimitExceededError(
          `You've reached the limit of ${rateLimit.limit} questions per ${rateLimit.windowMinutes} minutes. Please try again shortly.`,
        );
      }

      const apiKey = await userSubscription.getDecryptedKey(userId, 'anthropic');
      const result = await ask.ask(question, horizon, apiKey);
      // Only the LLM branch ever consumes rate-limit budget - a cache hit or a template
      // resolution costs nothing real (see candlestickQuestionAnswerRateLimit.service.ts).
      await recordRateLimitedCall(userId);

      // Resolved so the frontend can show a pattern diagram (CandlestickPatternDiagram.tsx) next
      // to an LLM-synthesized answer, same as it already can for a curated-picker selection
      // (which carries patternName directly on the entry). Union of two sources, deduped:
      // pattern names resolved via matched Q&A entries, and pattern names the model resolved
      // directly via filter_patterns_by_metadata (matchedPatternNames) - a purely-structural
      // answer has no entry_ids at all, but should still surface its pattern(s) for diagrams.
      const matchedEntries = await Promise.all(result.matchedEntryIds.map((id) => candlestickQuestionAnswer.getEntryById(id)));
      const entryPatternNames = matchedEntries.filter((e): e is NonNullable<typeof e> => e !== null).map((e) => e.patternName);
      const matchedPatternNames = [...new Set([...entryPatternNames, ...result.matchedPatternNames])];
      const matchedPatterns = await enrichMatchedPatterns(matchedPatternNames, horizon);

      await askedQuestion.recordAskedQuestion({
        questionText: question,
        horizon,
        answerText: result.answer,
        matchedPatternNames: matchedPatterns,
        status: result.outcome === 'answered_from_kb' ? 'Answered' : 'Unable_To_Answer',
      });

      // Fire-and-forget, same pattern as every other feature's usage-tracking call - a logging
      // failure must never break the real response the user is waiting on.
      usageTracking.logUsage(userId, 'candlestick_question_answer', result.llmCallDetails)
        .catch((e) => console.error('usage log failed', e));

      res.json({
        outcome: result.outcome,
        answer: result.answer,
        matchedEntryIds: result.matchedEntryIds,
        matchedPatterns,
        reason: result.reason,
      });
      return;
    }

    const templateResult = await questionTemplate.matchTemplate(question);
    const formattedAnswer = templateResult ? questionTemplate.formatTemplateAnswer(templateResult) : null;

    if (formattedAnswer && templateResult) {
      const matchedPatternNames = templateResult.matches.map((m) => m.patternName);
      const matchedPatterns = await enrichMatchedPatterns(matchedPatternNames, horizon);
      await askedQuestion.recordAskedQuestion({
        questionText: question, horizon, answerText: formattedAnswer, matchedPatternNames: matchedPatterns, status: 'Answered',
      });
      res.json({ outcome: 'answered_from_kb', answer: formattedAnswer, matchedEntryIds: [], matchedPatterns, reason: null });
      return;
    }

    await askedQuestion.recordAskedQuestion({
      questionText: question, horizon, answerText: null, matchedPatternNames: [], status: 'Unable_To_Answer',
    });
    res.json({
      outcome: 'unable_to_answer',
      answer: null,
      matchedEntryIds: [],
      matchedPatterns: [],
      reason: 'This role cannot use the free-text LLM assistant, and no matching question template was found.',
    });
  } catch (err) {
    if (err instanceof CandlestickQuestionAnswerRateLimitExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    if (err instanceof userSubscription.MissingUserApiKeyError) {
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// --- Admin content management (candlestick_question_answer:manage_content) ---

export async function listPatterns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const patterns = await candlestickQuestionAnswer.listPatterns();
    res.json({ patterns });
  } catch (err) {
    next(err);
  }
}

export async function createPattern(req: Request, res: Response, next: NextFunction): Promise<void> {
  const patternName = typeof req.body?.patternName === 'string' ? req.body.patternName.trim() : '';
  const formationDescription = typeof req.body?.formationDescription === 'string' ? req.body.formationDescription.trim() : '';
  const relevantHorizons = parseRelevantHorizons(req.body?.relevantHorizons);
  const complexityTier = parseComplexityTier(req.body?.complexityTier);
  if (!patternName || !formationDescription) {
    res.status(400).json({ error: 'patternName and formationDescription are required.' });
    return;
  }
  if (!relevantHorizons) {
    res.status(400).json({ error: `relevantHorizons must be a non-empty array of: ${VALID_HORIZONS.join(', ')}` });
    return;
  }
  if (!complexityTier) {
    res.status(400).json({ error: `complexityTier must be one of: ${VALID_COMPLEXITY_TIERS.join(', ')}` });
    return;
  }
  try {
    const pattern = await candlestickQuestionAnswer.createPattern({ patternName, formationDescription, relevantHorizons, complexityTier });
    res.status(201).json({ pattern });
  } catch (err) {
    if (err instanceof candlestickQuestionAnswer.DuplicatePatternNameError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function listAllEntries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entries = await candlestickQuestionAnswer.listAllEntries();
    res.json({ entries });
  } catch (err) {
    next(err);
  }
}

export async function createEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { patternId, questionText, answerText } = req.body ?? {};
  const category = parseCategory(req.body?.category);
  const tier = parseTier(req.body?.tier);
  if (typeof patternId !== 'string' || !patternId) {
    res.status(400).json({ error: 'patternId is required.' });
    return;
  }
  if (!category) {
    res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    return;
  }
  if (!tier) {
    res.status(400).json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` });
    return;
  }
  if (typeof questionText !== 'string' || !questionText.trim() || typeof answerText !== 'string' || !answerText.trim()) {
    res.status(400).json({ error: 'questionText and answerText are required.' });
    return;
  }
  try {
    const entry = await candlestickQuestionAnswer.createEntry({
      patternId, category, tier, questionText: questionText.trim(), answerText: answerText.trim(), createdBy: getUserId(req),
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
}

export async function setEntryStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { status } = req.body ?? {};
  if (status !== 'Approved' && status !== 'Rejected') {
    res.status(400).json({ error: `status must be "Approved" or "Rejected".` });
    return;
  }
  try {
    await candlestickQuestionAnswer.setEntryStatus(String(req.params.id), status, getUserId(req));
    res.json({ success: true });
  } catch (err) {
    if (err instanceof candlestickQuestionAnswer.EntryNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// --- Popular Questions (candlestick_question_answer:ask - a read, same "viewing is free"
// precedent as searchEntries above) ---

export async function listTopQuestions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const questions = await askedQuestion.listTopQuestions();
    res.json({ questions });
  } catch (err) {
    next(err);
  }
}

// --- Question Templates admin management (candlestick_question_answer:manage_content) ---

const VALID_RESPONSE_MODES: questionTemplate.ResponseMode[] = ['single', 'list'];

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await questionTemplate.listTemplates();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim() : '';
  const regexPattern = typeof req.body?.regexPattern === 'string' ? req.body.regexPattern.trim() : '';
  const responseMode = req.body?.responseMode;
  const answerTemplate = typeof req.body?.answerTemplate === 'string' ? req.body.answerTemplate.trim() : '';
  const filterMapping = req.body?.filterMapping;
  if (!templateKey || !regexPattern || !answerTemplate) {
    res.status(400).json({ error: 'templateKey, regexPattern, and answerTemplate are required.' });
    return;
  }
  if (!VALID_RESPONSE_MODES.includes(responseMode)) {
    res.status(400).json({ error: `responseMode must be one of: ${VALID_RESPONSE_MODES.join(', ')}` });
    return;
  }
  if (typeof filterMapping !== 'object' || filterMapping === null || !filterMapping.groupFilters && !filterMapping.fixedFilters) {
    res.status(400).json({ error: 'filterMapping must be an object with at least one of fixedFilters/groupFilters.' });
    return;
  }
  try {
    const template = await questionTemplate.createTemplate({
      templateKey, regexPattern, responseMode, filterMapping,
      answerTemplate,
    });
    res.status(201).json({ template });
  } catch (err) {
    if (err instanceof questionTemplate.DuplicateTemplateKeyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function setTemplateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { status } = req.body ?? {};
  if (status !== 'active' && status !== 'inactive') {
    res.status(400).json({ error: `status must be "active" or "inactive".` });
    return;
  }
  try {
    await questionTemplate.setTemplateStatus(String(req.params.id), status);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
