jest.mock('../src/services/anthropicClient.service', () => ({ createMessage: jest.fn() }));
// Partial mock: keep the real NoFilterCriteriaError class (so instanceof checks in the ask loop
// still work) while stubbing the two query functions - same pattern this codebase already uses
// for modules that export custom Error classes alongside functions.
jest.mock('../src/services/candlestickQuestionAnswer.service', () => ({
  ...jest.requireActual('../src/services/candlestickQuestionAnswer.service'),
  searchEntries: jest.fn(),
  filterPatternsByMetadata: jest.fn(),
}));
jest.mock('../src/services/configProperty.service', () => ({ getConfigValue: jest.fn() }));

import { createMessage } from '../src/services/anthropicClient.service';
import { searchEntries, filterPatternsByMetadata, NoFilterCriteriaError } from '../src/services/candlestickQuestionAnswer.service';
import { getConfigValue } from '../src/services/configProperty.service';
import { ask } from '../src/services/candlestickQuestionAnswerAsk.service';

const mockCreateMessage = createMessage as jest.Mock;
const mockSearchEntries = searchEntries as jest.Mock;
const mockFilterPatternsByMetadata = filterPatternsByMetadata as jest.Mock;
const mockGetConfigValue = getConfigValue as jest.Mock;

function usage(inputTokens: number, outputTokens: number) {
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

beforeEach(() => {
  mockCreateMessage.mockReset();
  mockSearchEntries.mockReset();
  mockFilterPatternsByMetadata.mockReset();
  mockGetConfigValue.mockReset();
  mockGetConfigValue.mockResolvedValue(null); // falls back to the default model
});

describe('ask', () => {
  test('resolves via provide_answer after searching the curated DB once', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      { id: 'e1', questionText: 'What is a Doji?', answerText: 'A Doji is...' },
    ]);
    mockCreateMessage
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'search_question_answer_entries', input: { query: 'doji' } }],
        usage: usage(100, 20),
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't2', name: 'provide_answer', input: { entry_ids: ['e1'], synthesized_answer: 'A Doji signals indecision.' } }],
        usage: usage(150, 30),
      });

    const result = await ask('What is a Doji?', 'dayTrading', 'test-anthropic-key');

    expect(result).toEqual({
      outcome: 'answered_from_kb',
      answer: 'A Doji signals indecision.',
      matchedEntryIds: ['e1'],
      matchedPatternNames: [],
      reason: null,
      llmCallDetails: { llm_tokens_in: 250, llm_tokens_out: 50 }, // summed across both turns
    });
    // search_question_answer_entries scopes to the caller's chosen horizon automatically.
    expect(mockSearchEntries).toHaveBeenCalledWith({ query: 'doji', horizon: 'dayTrading', tier: undefined });
  });

  test('resolves a structural question via filter_patterns_by_metadata alone, surfacing matched_pattern_names with no entry_ids', async () => {
    mockFilterPatternsByMetadata.mockResolvedValueOnce([
      { patternName: 'Upside Tasuki Gap', signalType: 'continuation', directionalBias: 'bullish', requiresGap: true, trendContext: 'prior-uptrend', complexityTier: 'Advanced', mirrorPatternName: 'Downside Tasuki Gap' },
    ]);
    mockCreateMessage
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'filter_patterns_by_metadata', input: { signal_type: 'continuation', requires_gap: true } }],
        usage: usage(100, 20),
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't2', name: 'provide_answer', input: { matched_pattern_names: ['Upside Tasuki Gap'], synthesized_answer: 'Upside Tasuki Gap is a continuation pattern that requires a gap.' } }],
        usage: usage(150, 30),
      });

    const result = await ask('Which continuation patterns need a gap?', 'mediumTerm', 'test-anthropic-key');

    expect(result).toEqual({
      outcome: 'answered_from_kb',
      answer: 'Upside Tasuki Gap is a continuation pattern that requires a gap.',
      matchedEntryIds: [],
      matchedPatternNames: ['Upside Tasuki Gap'],
      reason: null,
      llmCallDetails: { llm_tokens_in: 250, llm_tokens_out: 50 },
    });
    expect(mockFilterPatternsByMetadata).toHaveBeenCalledWith({
      patternNameOrSynonym: undefined, signalType: 'continuation', directionalBias: undefined,
      complexityTier: undefined, requiresGap: true, trendContext: undefined, horizon: 'mediumTerm',
    });
    expect(mockSearchEntries).not.toHaveBeenCalled();
  });

  test('chains filter_patterns_by_metadata then search_question_answer_entries in one call for a compound question', async () => {
    mockFilterPatternsByMetadata.mockResolvedValueOnce([
      { patternName: 'Downside Tasuki Gap', signalType: 'continuation', directionalBias: 'bearish', requiresGap: true, trendContext: 'prior-downtrend', complexityTier: 'Advanced', mirrorPatternName: 'Upside Tasuki Gap' },
    ]);
    mockSearchEntries.mockResolvedValueOnce([
      { id: 'e9', questionText: 'How reliable is Downside Tasuki Gap?', answerText: 'Moderately reliable...' },
    ]);
    mockCreateMessage
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'filter_patterns_by_metadata', input: { signal_type: 'continuation', directional_bias: 'bearish', requires_gap: true } }],
        usage: usage(100, 20),
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't2', name: 'search_question_answer_entries', input: { query: 'Downside Tasuki Gap reliability' } }],
        usage: usage(120, 25),
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't3', name: 'provide_answer', input: { entry_ids: ['e9'], matched_pattern_names: ['Downside Tasuki Gap'], synthesized_answer: "It's Downside Tasuki Gap, moderately reliable." } }],
        usage: usage(150, 30),
      });

    const result = await ask('What bearish continuation pattern needs a gap, and how reliable is it?', 'longTerm', 'test-anthropic-key');

    expect(result.outcome).toBe('answered_from_kb');
    expect(result.matchedEntryIds).toEqual(['e9']);
    expect(result.matchedPatternNames).toEqual(['Downside Tasuki Gap']);
    expect(mockFilterPatternsByMetadata).toHaveBeenCalledTimes(1);
    expect(mockSearchEntries).toHaveBeenCalledTimes(1);
  });

  test('a NoFilterCriteriaError from filter_patterns_by_metadata is a recoverable tool error, not a terminal failure', async () => {
    mockFilterPatternsByMetadata.mockRejectedValueOnce(new NoFilterCriteriaError('At least one filter must be given.'));
    mockCreateMessage
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'filter_patterns_by_metadata', input: {} }],
        usage: usage(50, 10),
      })
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't2', name: 'unable_to_answer', input: { reason: 'Could not narrow down a pattern.' } }],
        usage: usage(60, 10),
      });

    const result = await ask('Tell me about a pattern', 'dayTrading', 'test-anthropic-key');

    // The loop survived the error and reached a second turn, rather than crashing or treating
    // it as an immediate failure.
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockCreateMessage.mock.calls[1][1].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(toolResultMessage.content[0].is_error).toBe(true);
    expect(result.outcome).toBe('unable_to_answer');
  });

  test('resolves via unable_to_answer when the model calls that tool directly', async () => {
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't1', name: 'unable_to_answer', input: { reason: 'Not covered yet.' } }],
      usage: usage(80, 15),
    });

    const result = await ask('What is the meaning of life?', 'longTerm', 'test-anthropic-key');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.answer).toBeNull();
    expect(result.reason).toBe('Not covered yet.');
    expect(mockSearchEntries).not.toHaveBeenCalled();
  });

  test('a plain-text response with no tool call is treated as unable_to_answer, not trusted as a real answer', async () => {
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I think a Doji means...' }],
      usage: usage(50, 10),
    });

    const result = await ask('What is a Doji?', 'dayTrading', 'test-anthropic-key');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.reason).toMatch(/did not use the curated knowledge base/i);
  });

  test('gives up after the max tool-call iterations rather than looping forever', async () => {
    mockSearchEntries.mockResolvedValue([]);
    // Every turn just searches again, never reaching a terminal tool.
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'tool_use', id: 't1', name: 'search_question_answer_entries', input: { query: 'x' } }],
      usage: usage(10, 5),
    });

    const result = await ask('An endlessly vague question', 'mediumTerm', 'test-anthropic-key');

    expect(result.outcome).toBe('unable_to_answer');
    expect(result.reason).toMatch(/allowed number of search attempts/i);
    // Bounded, not unbounded - confirms the safety cap actually stops the loop.
    expect(mockCreateMessage.mock.calls.length).toBeLessThanOrEqual(5);
  });

  test('uses the Config-Properties-driven model name when one is set, falling back to the default otherwise', async () => {
    mockGetConfigValue.mockResolvedValueOnce('claude-opus-5');
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 't1', name: 'unable_to_answer', input: { reason: 'n/a' } }],
      usage: usage(5, 5),
    });

    await ask('Q', 'dayTrading', 'test-anthropic-key');

    expect(mockCreateMessage.mock.calls[0][1].model).toBe('claude-opus-5');
  });
});
