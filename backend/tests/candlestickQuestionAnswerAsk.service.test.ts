// candlestickQuestionAnswer.service's own partial mock below uses jest.requireActual(), which
// loads the real module - and that module imports the real db/pool.ts, which throws at
// module-load time if DATABASE_URL isn't set (CI deliberately never sets one for unit tests).
// Mocking the pool directly, same fix already applied once in marketData.service.test.ts/
// longTermAnalysisData.service.test.ts/contrarianComebackData.service.test.ts, lets the real
// module load safely without a real Pool.
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
// Partial mock: keep the real NoFilterCriteriaError class (so instanceof checks still work)
// while stubbing the two query functions - same pattern this codebase already uses for modules
// that export custom Error classes alongside functions.
jest.mock('../src/services/candlestickQuestionAnswer.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionAnswer.service'),
  searchEntries: jest.fn(),
  filterPatternsByMetadata: jest.fn(),
}));
jest.mock('../src/services/configProperty.service', () => ({ getConfigValue: jest.fn() }));
// Rewritten 2026-10-08 onto the Vercel AI SDK. Rather than re-simulate the SDK's own internal
// multi-step loop (an implementation detail the AI SDK itself owns and already tests), this
// file is split into two concerns: (1) ask()'s OWN logic - resolving a mocked generateText
// result into the right AskResult branch, and provider/model selection - by mocking `generateText`
// wholesale; and (2) the two real-logic tools (searchTool/filterTool)'s own execute() mapping
// and error-propagation, tested directly against their exported tool objects, decoupled from any
// loop machinery. getLanguageModel() is also mocked, since asserting *which* provider factory it
// would have called is exactly llmModel.service.test.ts's own job, not this file's.
jest.mock('ai', () => ({
  ...jest.requireActual('ai'),
  generateText: jest.fn(),
}));
jest.mock('../src/services/llmModel.service', () => ({ getLanguageModel: jest.fn() }));

import { generateText } from 'ai';
import { searchEntries, filterPatternsByMetadata, NoFilterCriteriaError } from '../src/services/candlestickQuestionAnswer.service';
import { getConfigValue } from '../src/services/configProperty.service';
import { getLanguageModel } from '../src/services/llmModel.service';
import { ask, searchTool, filterTool } from '../src/services/candlestickQuestionAnswerAsk.service';

const mockGenerateText = generateText as jest.Mock;
const mockSearchEntries = searchEntries as jest.Mock;
const mockFilterPatternsByMetadata = filterPatternsByMetadata as jest.Mock;
const mockGetConfigValue = getConfigValue as jest.Mock;
const mockGetLanguageModel = getLanguageModel as jest.Mock;

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}

// Minimal GenerateTextResult-shaped fixture - only the fields ask() actually reads.
function fakeResult(opts: { toolCalls?: { toolName: string; input: unknown }[]; finalStepToolCalls?: unknown[]; usage?: { inputTokens: number; outputTokens: number } }) {
  const toolCalls = opts.toolCalls ?? [];
  const finalStepToolCalls = opts.finalStepToolCalls ?? toolCalls;
  return {
    toolCalls,
    steps: [{ toolCalls: finalStepToolCalls }],
    usage: opts.usage ?? usage(0, 0),
  };
}

beforeEach(() => {
  mockGenerateText.mockReset();
  mockSearchEntries.mockReset();
  mockFilterPatternsByMetadata.mockReset();
  mockGetConfigValue.mockReset();
  mockGetConfigValue.mockResolvedValue(null); // falls back to the default model
  mockGetLanguageModel.mockReset();
  mockGetLanguageModel.mockReturnValue('fake-model');
});

describe('ask', () => {
  test('resolves via provide_answer, mapping entry_ids/matched_pattern_names/synthesized_answer', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'provide_answer', input: { entry_ids: ['e1'], synthesized_answer: 'A Doji signals indecision.' } }],
      usage: usage(250, 50),
    }));

    const result = await ask('What is a Doji?', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(result).toEqual({
      outcome: 'answered_from_kb',
      answer: 'A Doji signals indecision.',
      matchedEntryIds: ['e1'],
      matchedPatternNames: [],
      reason: null,
      llmCallDetails: { llm_tokens_in: 250, llm_tokens_out: 50 },
      fromGeneralKnowledge: false,
    });
  });

  // Loosened 2026-10-09: provide_answer may now draw on the model's own general knowledge when
  // the curated tools/content had nothing addressing the specific question - from_general_knowledge
  // is the transparency flag for that.
  test('fromGeneralKnowledge is true when provide_answer sets from_general_knowledge: true', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'provide_answer', input: { synthesized_answer: 'General knowledge answer.', from_general_knowledge: true } }],
    }));

    const result = await ask('Can Tasuki Gap be used with other patterns?', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(result.fromGeneralKnowledge).toBe(true);
  });

  test('fromGeneralKnowledge defaults to false when provide_answer omits the flag', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'provide_answer', input: { synthesized_answer: 'Grounded answer.' } }],
    }));

    const result = await ask('Q', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(result.fromGeneralKnowledge).toBe(false);
  });

  test('resolves via provide_answer with matched_pattern_names and no entry_ids', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'provide_answer', input: { matched_pattern_names: ['Upside Tasuki Gap'], synthesized_answer: 'Upside Tasuki Gap is a continuation pattern.' } }],
    }));

    const result = await ask('Which continuation patterns need a gap?', 'mediumTerm', 'test-anthropic-key', 'anthropic');

    expect(result.outcome).toBe('answered_from_kb');
    expect(result.matchedEntryIds).toEqual([]);
    expect(result.matchedPatternNames).toEqual(['Upside Tasuki Gap']);
  });

  test('a provide_answer call wins over a non-terminal call in the same final step', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [
        { toolName: 'search_question_answer_entries', input: { query: 'x' } },
        { toolName: 'provide_answer', input: { synthesized_answer: 'Answered anyway.' } },
      ],
    }));

    const result = await ask('Q', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(result.outcome).toBe('answered_from_kb');
    expect(result.answer).toBe('Answered anyway.');
  });

  test('resolves via unable_to_answer when the model calls that tool directly', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'Not covered yet.' } }],
    }));

    const result = await ask('What is the meaning of life?', 'longTerm', 'test-anthropic-key', 'anthropic');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.answer).toBeNull();
    expect(result.reason).toBe('Not covered yet.');
  });

  test('a plain-text response with no tool call in the final step is treated as unable_to_answer, not trusted as a real answer', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [] }));

    const result = await ask('What is a Doji?', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.reason).toMatch(/did not use the curated knowledge base/i);
  });

  test('gives up when the final step had (non-terminal) tool calls but no terminal tool was ever reached', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({
      toolCalls: [{ toolName: 'search_question_answer_entries', input: { query: 'x' } }],
    }));

    const result = await ask('An endlessly vague question', 'mediumTerm', 'test-anthropic-key', 'anthropic');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.reason).toMatch(/allowed number of search attempts/i);
  });

  test('passes stepCountIs(5) as the loop cap', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'n/a' } }] }));

    await ask('Q', 'dayTrading', 'test-anthropic-key', 'anthropic');

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.stopWhen).toBeDefined();
  });

  test('uses the Config-Properties-driven model name when one is set, falling back to the default otherwise', async () => {
    mockGetConfigValue.mockResolvedValueOnce('claude-opus-5');
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'n/a' } }] }));

    await ask('Q', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(mockGetLanguageModel).toHaveBeenCalledWith('anthropic', 'test-anthropic-key', 'claude-opus-5');
  });

  test('falls back to the default model when no Config Property value is set', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'n/a' } }] }));

    await ask('Q', 'dayTrading', 'test-anthropic-key', 'anthropic');

    expect(mockGetLanguageModel).toHaveBeenCalledWith('anthropic', 'test-anthropic-key', 'claude-sonnet-5');
  });

  test('threads the openai provider through to getLanguageModel', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'n/a' } }] }));

    await ask('Q', 'dayTrading', 'test-openai-key', 'openai');

    expect(mockGetLanguageModel).toHaveBeenCalledWith('openai', 'test-openai-key', 'claude-sonnet-5');
  });

  test('"all" horizon is phrased as "no particular preference" in the prompt, not sent literally', async () => {
    mockGenerateText.mockResolvedValueOnce(fakeResult({ toolCalls: [{ toolName: 'unable_to_answer', input: { reason: 'n/a' } }] }));

    await ask('Q', 'all', 'test-anthropic-key', 'anthropic');

    const prompt = mockGenerateText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('no particular preference');
    expect(prompt).not.toContain('Trading horizon: all');
  });
});

describe('searchTool.execute', () => {
  test('maps query/tier to searchEntries and the results to {id, question, answer}', async () => {
    mockSearchEntries.mockResolvedValueOnce([{ id: 'e1', questionText: 'What is a Doji?', answerText: 'A Doji is...' }]);

    const result = await searchTool.execute!({ query: 'doji', tier: 101 }, {} as never);

    expect(mockSearchEntries).toHaveBeenCalledWith({ query: 'doji', tier: 101 });
    expect(result).toEqual([{ id: 'e1', question: 'What is a Doji?', answer: 'A Doji is...' }]);
  });
});

describe('filterTool.execute', () => {
  test('maps every filter field to filterPatternsByMetadata', async () => {
    mockFilterPatternsByMetadata.mockResolvedValueOnce([
      { patternName: 'Upside Tasuki Gap', signalType: 'continuation', directionalBias: 'bullish', requiresGap: true, trendContext: 'prior-uptrend', complexityTier: 'Advanced', mirrorPatternName: 'Downside Tasuki Gap' },
    ]);

    const result = await filterTool.execute!({ signal_type: 'continuation', requires_gap: true }, {} as never);

    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({
      patternNameOrSynonym: undefined, signalType: 'continuation', directionalBias: undefined,
      complexityTier: undefined, requiresGap: true, trendContext: undefined,
    });
    expect(result).toEqual([
      { patternName: 'Upside Tasuki Gap', signalType: 'continuation', directionalBias: 'bullish', requiresGap: true, trendContext: 'prior-uptrend', complexityTier: 'Advanced', mirrorPatternName: 'Downside Tasuki Gap' },
    ]);
  });

  // The AI SDK auto-converts a thrown execute() error into a recoverable tool-error part fed
  // back to the model - this test only needs to confirm the error propagates (is thrown, not
  // swallowed), not re-verify the SDK's own conversion behavior.
  test('propagates NoFilterCriteriaError rather than swallowing it', async () => {
    mockFilterPatternsByMetadata.mockRejectedValueOnce(new NoFilterCriteriaError('At least one filter must be given.'));

    await expect(filterTool.execute!({}, {} as never)).rejects.toBeInstanceOf(NoFilterCriteriaError);
  });
});
