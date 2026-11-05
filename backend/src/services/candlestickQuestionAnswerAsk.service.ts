// Candlestick Pattern Q&A - the free-text ask path's function-calling loop.
//
// Design: the LLM gets exactly 4 tools - two non-terminal ones (search_question_answer_entries,
// backed by candlestickQuestionAnswer.service.searchEntries for interpretive/prose questions;
// filter_patterns_by_metadata, backed by .filterPatternsByMetadata for structural/factual
// questions - Phase 1 of the ReAct upgrade, 2026-10-05) and two mutually-exclusive terminal
// tools, provide_answer and unable_to_answer. The LLM's own tool choice IS the sufficiency
// judgment - there's no separate confidence-scoring pass. This also means a plain-text response
// with no tool call is treated as a failure to use the knowledge base correctly, not as a real
// answer (see the "no tool call at all" branch below) - the whole point of this design is that
// provide_answer is the only sanctioned way to state an answer.
//
// Rewritten 2026-10-08 onto the Vercel AI SDK (generateText/tool/stepCountIs) to make the LLM
// *provider* admin-switchable (Anthropic/OpenAI), not just the model - see
// llmModel.service.ts. The two terminal tools deliberately have no `execute`: per the AI SDK's
// own documented behavior, a tool called with no execute function ends the step loop - the
// exact same "never actually executed, just inspected" role these two tools already played in
// the old hand-rolled loop.

import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getLanguageModel, type LlmProvider } from './llmModel.service';
import * as candlestickQuestionAnswer from './candlestickQuestionAnswer.service';
import type { Horizon } from './candlestickQuestionAnswer.service';
import { getConfigValue } from './configProperty.service';

const DEFAULT_MODEL = 'claude-sonnet-5';
// Safety backstop against a pathological search-forever loop - not an expected real-world path.
const MAX_TOOL_ITERATIONS = 5;

export interface AskResult {
  outcome: 'answered_from_kb' | 'unable_to_answer';
  answer: string | null;
  matchedEntryIds: string[];
  matchedPatternNames: string[];
  reason: string | null;
  llmCallDetails: { llm_tokens_in: number; llm_tokens_out: number };
  // True only when provide_answer itself set from_general_knowledge: true - the curated
  // tools/content had nothing addressing this specific question, so the model answered from its
  // own general candlestick-pattern knowledge instead of refusing (2026-10-09). Always false for
  // every other branch below - this flag only ever comes from the model's own tool call.
  fromGeneralKnowledge: boolean;
}

// Exported for direct unit testing of their own execute() mapping/error-propagation, decoupled
// from mocking the AI SDK's own internal multi-step loop (see the test file's own header note).
export const searchTool = tool({
  description: "Search the curated candlestick-pattern knowledge base for entries relevant to the user's question. Call this one or more times with different search terms before deciding whether you can answer.",
  inputSchema: z.object({
    query: z.string().describe('Free-text search terms - pattern name or keywords from the question.'),
    tier: z.union([z.literal(101), z.literal(201), z.literal(301)]).optional().describe('Optional - narrow to one difficulty tier.'),
  }),
  execute: async ({ query, tier }) => {
    const results = await candlestickQuestionAnswer.searchEntries({ query, tier });
    return results.map((r) => ({ id: r.id, question: r.questionText, answer: r.answerText }));
  },
});

export const filterTool = tool({
  description: "Look up candlestick patterns by structural, factual properties: signal type (reversal/continuation/indecision), directional bias, whether a genuine price gap is required, trend context, or an exact/alias name match. Returns compact facts about matching patterns, never prose. Use this for 'which pattern(s)...' or 'is X bullish/bearish/a continuation signal' questions - call search_question_answer_entries instead for interpretive questions about reliability, usage, or common mistakes. At least one filter must be given.",
  inputSchema: z.object({
    pattern_name_or_synonym: z.string().optional().describe("Exact or alias name, e.g. 'pin bar' or 'Hammer'."),
    signal_type: z.enum(['reversal', 'continuation', 'indecision']).optional(),
    directional_bias: z.enum(['bullish', 'bearish', 'neutral', 'context-dependent']).optional(),
    complexity_tier: z.enum(['Simple', 'Composite', 'Advanced', 'Complex']).optional(),
    requires_gap: z.boolean().optional(),
    trend_context: z.enum(['prior-downtrend', 'prior-uptrend', 'either', 'none']).optional(),
  }),
  // A thrown error here becomes a tool-error part the AI SDK feeds back to the model
  // automatically (replacing the old code's manual is_error: true tool_result construction) -
  // recoverable, never a terminal failure: NoFilterCriteriaError tells the model to be specific
  // and try again.
  execute: async (input) => candlestickQuestionAnswer.filterPatternsByMetadata({
    patternNameOrSynonym: input.pattern_name_or_synonym,
    signalType: input.signal_type,
    directionalBias: input.directional_bias,
    complexityTier: input.complexity_tier,
    requiresGap: input.requires_gap,
    trendContext: input.trend_context,
  }),
});

// No `execute` - calling this ends the step loop (see file header). Never actually run;
// its validated `input` is read directly off the final step's tool call below.
const provideAnswerTool = tool({
  description: "Call this when you have an answer to the user's question - either grounded in tool results (preferred), or, when the tools returned nothing addressing this specific question, drawn from your own general candlestick-pattern-analysis knowledge (set from_general_knowledge: true in that case). Still only for candlestick-pattern education content - never personalized financial advice or a buy/sell recommendation.",
  inputSchema: z.object({
    entry_ids: z.array(z.string()).optional().describe('IDs of the curated entries this answer is drawn from, if any.'),
    matched_pattern_names: z.array(z.string()).optional().describe('Pattern names this answer is drawn from, if resolved via filter_patterns_by_metadata rather than (or in addition to) entry_ids.'),
    synthesized_answer: z.string().describe("A clear answer to the user's question, based on the retrieved entries/facts, or - only when nothing relevant was found - your own general candlestick-pattern-analysis knowledge."),
    from_general_knowledge: z.boolean().optional().describe('Set to true if this answer is NOT grounded in any tool result - i.e., you answered from your own general knowledge because the curated content had nothing addressing this specific question.'),
  }),
});

// No `execute` - same loop-ending role as provideAnswerTool above.
const unableToAnswerTool = tool({
  description: 'Call this only if the question is not about candlestick patterns at all, or you genuinely have no answer even from your own general candlestick-pattern knowledge. Never call this just because the curated tools/content had nothing - use provide_answer with from_general_knowledge: true for that case instead.',
  inputSchema: z.object({
    reason: z.string().describe('Briefly, why this could not be answered.'),
  }),
});

// Deliberately restricts the model to candlestick-pattern education (never personalized advice
// or a buy/sell call on a specific stock) - Architecture.md's Platform Objective posture
// ("never gives personalized financial advice") applied to this feature specifically, since an
// open-ended LLM is a materially higher drift risk than this app's existing static content.
//
// Loosened 2026-10-09 (explicit user direction, after a real report: "Can Tasuki Gap be used in
// conjunction with other patterns?" correctly got unable_to_answer, since no curated entry
// covers cross-pattern confluence) - the model may now answer from its own general knowledge
// when the curated tools have nothing addressing the specific question, instead of always
// refusing. The scope boundary itself (candlestick education only, never personalized advice)
// is untouched - only the "must be tool-grounded" rule loosened, and only with the
// from_general_knowledge transparency flag (provideAnswerTool's own schema) as the trade-off.
const SYSTEM_PROMPT = `You are a candlestick pattern education assistant for a self-directed retail stock investing platform. You answer questions ONLY about candlestick chart pattern recognition and interpretation (e.g. Doji, Hammer, Engulfing) - never personalized financial advice, and never a recommendation to buy or sell any specific stock.

Always try your tools first. You have two tools for finding information: filter_patterns_by_metadata for structural/factual questions about which patterns match given properties (signal type, directional bias, gap requirement, trend context, name/alias), and search_question_answer_entries for interpretive questions about a specific pattern's meaning, reliability, or usage. Use either or both as needed before calling a terminal tool.

Prefer the platform's own curated content whenever it addresses the question - build your answer primarily from tool results when they're relevant. If the tools return nothing that actually addresses the specific question (for example, a question about combining multiple patterns together, or a general candlestick-charting concept not tied to one specific curated entry), you may answer from your own general candlestick-pattern-analysis knowledge instead of refusing - but stay within the same strict scope (education only, never personalized advice or a buy/sell call), and set from_general_knowledge: true on provide_answer so the platform can label it as not drawn from its own curated content.

The user has indicated a trading-horizon preference (dayTrading, mediumTerm, longTerm, or no particular preference) for context - you may mention it if relevant, but never use it to exclude an otherwise-correct pattern from your answer; every pattern the tools return is a valid answer regardless of horizon.

If the question is not about candlestick patterns at all, call unable_to_answer rather than guessing or answering off-topic.`;

export async function ask(question: string, horizon: Horizon, apiKey: string, provider: LlmProvider): Promise<AskResult> {
  const modelId = (await getConfigValue('candlestick_question_answer_llm_model')) ?? DEFAULT_MODEL;
  const model = getLanguageModel(provider, apiKey, modelId);
  const horizonForPrompt = horizon === 'all' ? 'no particular preference' : horizon;

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `Trading horizon: ${horizonForPrompt}\n\nQuestion: ${question}`,
    tools: {
      search_question_answer_entries: searchTool,
      filter_patterns_by_metadata: filterTool,
      provide_answer: provideAnswerTool,
      unable_to_answer: unableToAnswerTool,
    },
    stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
  });

  const llmCallDetails = { llm_tokens_in: result.usage.inputTokens ?? 0, llm_tokens_out: result.usage.outputTokens ?? 0 };

  // A terminal tool, once called, can only ever appear in the loop's final step (it has no
  // execute, so the loop cannot continue past it) - searching the cumulative toolCalls is
  // therefore equivalent to checking just the final step, and (matching the old loop's own
  // per-turn preference) a terminal call wins even if the model also called a non-terminal tool
  // in that same final step.
  const provideAnswerCall = result.toolCalls.find((c) => c.toolName === 'provide_answer');
  if (provideAnswerCall) {
    const input = provideAnswerCall.input as { entry_ids?: string[]; matched_pattern_names?: string[]; synthesized_answer: string; from_general_knowledge?: boolean };
    return {
      outcome: 'answered_from_kb',
      answer: input.synthesized_answer,
      matchedEntryIds: input.entry_ids ?? [],
      matchedPatternNames: input.matched_pattern_names ?? [],
      reason: null,
      llmCallDetails,
      fromGeneralKnowledge: input.from_general_knowledge ?? false,
    };
  }

  const unableToAnswerCall = result.toolCalls.find((c) => c.toolName === 'unable_to_answer');
  if (unableToAnswerCall) {
    const input = unableToAnswerCall.input as { reason: string };
    return {
      outcome: 'unable_to_answer',
      answer: null,
      matchedEntryIds: [],
      matchedPatternNames: [],
      reason: input.reason,
      llmCallDetails,
      fromGeneralKnowledge: false,
    };
  }

  const finalStep = result.steps[result.steps.length - 1];
  if (!finalStep || finalStep.toolCalls.length === 0) {
    // Plain text with no tool call at all (in the final step) - never trust free-form text as a
    // real answer; provide_answer is the only sanctioned way to state one.
    return {
      outcome: 'unable_to_answer',
      answer: null,
      matchedEntryIds: [],
      matchedPatternNames: [],
      reason: 'The model did not use the curated knowledge base to answer this question.',
      llmCallDetails,
      fromGeneralKnowledge: false,
    };
  }

  // The final step had (non-terminal) tool calls, but the step cap was reached before either
  // terminal tool was ever called.
  return {
    outcome: 'unable_to_answer',
    answer: null,
    matchedEntryIds: [],
    matchedPatternNames: [],
    reason: 'Could not resolve an answer within the allowed number of search attempts.',
    llmCallDetails,
    fromGeneralKnowledge: false,
  };
}
