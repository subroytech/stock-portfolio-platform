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

import Anthropic from '@anthropic-ai/sdk';
import * as anthropicClient from './anthropicClient.service';
import * as candlestickQuestionAnswer from './candlestickQuestionAnswer.service';
import type { Horizon, Tier, ComplexityTier, SignalType, DirectionalBias, TrendContext } from './candlestickQuestionAnswer.service';
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
}

const SEARCH_TOOL: Anthropic.Tool = {
  name: 'search_question_answer_entries',
  description: "Search the curated candlestick-pattern knowledge base for entries relevant to the user's question, scoped to their chosen trading horizon. Call this one or more times with different search terms before deciding whether you can answer.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text search terms - pattern name or keywords from the question.' },
      tier: { type: 'integer', enum: [101, 201, 301], description: 'Optional - narrow to one difficulty tier.' },
    },
    required: ['query'],
  },
};

const FILTER_TOOL: Anthropic.Tool = {
  name: 'filter_patterns_by_metadata',
  description: "Look up candlestick patterns by structural, factual properties: signal type (reversal/continuation/indecision), directional bias, whether a genuine price gap is required, trend context, or an exact/alias name match. Returns compact facts about matching patterns, never prose. Use this for 'which pattern(s)...' or 'is X bullish/bearish/a continuation signal' questions - call search_question_answer_entries instead for interpretive questions about reliability, usage, or common mistakes. At least one filter must be given.",
  input_schema: {
    type: 'object',
    properties: {
      pattern_name_or_synonym: { type: 'string', description: "Exact or alias name, e.g. 'pin bar' or 'Hammer'." },
      signal_type: { type: 'string', enum: ['reversal', 'continuation', 'indecision'] },
      directional_bias: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'context-dependent'] },
      complexity_tier: { type: 'string', enum: ['Simple', 'Composite', 'Advanced', 'Complex'] },
      requires_gap: { type: 'boolean' },
      trend_context: { type: 'string', enum: ['prior-downtrend', 'prior-uptrend', 'either', 'none'] },
    },
  },
};

const PROVIDE_ANSWER_TOOL: Anthropic.Tool = {
  name: 'provide_answer',
  description: "Call this ONLY when the information you retrieved genuinely answers the user's question. Never call this to provide an answer from your own general knowledge - only synthesize from entries/facts found via search_question_answer_entries or filter_patterns_by_metadata.",
  input_schema: {
    type: 'object',
    properties: {
      entry_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of the curated entries this answer is drawn from, if any.' },
      matched_pattern_names: { type: 'array', items: { type: 'string' }, description: 'Pattern names this answer is drawn from, if resolved via filter_patterns_by_metadata rather than (or in addition to) entry_ids.' },
      synthesized_answer: { type: 'string', description: "A clear answer to the user's question, based only on the retrieved entries/facts." },
    },
    required: ['synthesized_answer'],
  },
};

const UNABLE_TO_ANSWER_TOOL: Anthropic.Tool = {
  name: 'unable_to_answer',
  description: 'Call this if, after searching, the curated knowledge base genuinely does not contain a good answer to the question. Always prefer this over guessing or answering from general knowledge.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Briefly, why the curated content did not answer this question.' },
    },
    required: ['reason'],
  },
};

// Deliberately restricts the model to candlestick-pattern education (never personalized advice
// or a buy/sell call on a specific stock) - Architecture.md's Platform Objective posture
// ("never gives personalized financial advice") applied to this feature specifically, since an
// open-ended LLM is a materially higher drift risk than this app's existing static content.
const SYSTEM_PROMPT = `You are a candlestick pattern education assistant for a self-directed retail stock investing platform. You answer questions ONLY about candlestick chart pattern recognition and interpretation (e.g. Doji, Hammer, Engulfing) - never personalized financial advice, and never a recommendation to buy or sell any specific stock. You must answer strictly using tool results, scoped to the user's chosen trading horizon (dayTrading, mediumTerm, or longTerm) - never from your own general knowledge. You have two tools for finding information: filter_patterns_by_metadata for structural/factual questions about which patterns match given properties (signal type, directional bias, gap requirement, trend context, name/alias), and search_question_answer_entries for interpretive questions about a specific pattern's meaning, reliability, or usage. Use either or both as needed before calling a terminal tool. If the question is not about candlestick patterns at all, or neither tool turns up a good answer, call unable_to_answer rather than guessing.`;

export async function ask(question: string, horizon: Horizon, apiKey: string): Promise<AskResult> {
  const model = (await getConfigValue('candlestick_question_answer_llm_model')) ?? DEFAULT_MODEL;
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Trading horizon: ${horizon}\n\nQuestion: ${question}` },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropicClient.createMessage(apiKey, {
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools: [SEARCH_TOOL, FILTER_TOOL, PROVIDE_ANSWER_TOOL, UNABLE_TO_ANSWER_TOOL],
    });
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    const llmCallDetails = { llm_tokens_in: totalInputTokens, llm_tokens_out: totalOutputTokens };

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const terminal = toolUseBlocks.find((b) => b.name === 'provide_answer' || b.name === 'unable_to_answer');

    if (terminal?.name === 'provide_answer') {
      const input = terminal.input as { entry_ids?: unknown; matched_pattern_names?: unknown; synthesized_answer?: string };
      return {
        outcome: 'answered_from_kb',
        answer: input.synthesized_answer ?? null,
        matchedEntryIds: Array.isArray(input.entry_ids) ? input.entry_ids.map(String) : [],
        matchedPatternNames: Array.isArray(input.matched_pattern_names) ? input.matched_pattern_names.map(String) : [],
        reason: null,
        llmCallDetails,
      };
    }
    if (terminal?.name === 'unable_to_answer') {
      const input = terminal.input as { reason?: string };
      return {
        outcome: 'unable_to_answer',
        answer: null,
        matchedEntryIds: [],
        matchedPatternNames: [],
        reason: input.reason ?? 'The curated knowledge base does not cover this question yet.',
        llmCallDetails,
      };
    }

    if (toolUseBlocks.length === 0) {
      // Plain text with no tool call at all - never trust free-form text as a real answer;
      // provide_answer is the only sanctioned way to state one.
      return {
        outcome: 'unable_to_answer',
        answer: null,
        matchedEntryIds: [],
        matchedPatternNames: [],
        reason: 'The model did not use the curated knowledge base to answer this question.',
        llmCallDetails,
      };
    }

    // Only the 2 non-terminal tools are possible here (the other 2 are always terminal and
    // already handled above) - execute whichever was called, feed results back, let the model
    // decide its next move (another tool call, possibly the other one, or a terminal tool).
    messages.push({ role: 'assistant', content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (block.name === 'filter_patterns_by_metadata') {
        const input = block.input as {
          pattern_name_or_synonym?: string; signal_type?: string; directional_bias?: string;
          complexity_tier?: string; requires_gap?: boolean; trend_context?: string;
        };
        try {
          const results = await candlestickQuestionAnswer.filterPatternsByMetadata({
            patternNameOrSynonym: input.pattern_name_or_synonym,
            signalType: input.signal_type as SignalType | undefined,
            directionalBias: input.directional_bias as DirectionalBias | undefined,
            complexityTier: input.complexity_tier as ComplexityTier | undefined,
            requiresGap: input.requires_gap,
            trendContext: input.trend_context as TrendContext | undefined,
            horizon,
          });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(results) });
        } catch (err) {
          if (err instanceof candlestickQuestionAnswer.NoFilterCriteriaError) {
            // Recoverable - tell the model to be specific and let it try again, never a
            // terminal failure.
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true });
          } else {
            throw err;
          }
        }
        continue;
      }

      const input = block.input as { query?: string; tier?: number };
      const results = await candlestickQuestionAnswer.searchEntries({
        query: input.query,
        horizon,
        tier: input.tier as Tier | undefined,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(results.map((r) => ({ id: r.id, question: r.questionText, answer: r.answerText }))),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    outcome: 'unable_to_answer',
    answer: null,
    matchedEntryIds: [],
    matchedPatternNames: [],
    reason: 'Could not resolve an answer within the allowed number of search attempts.',
    llmCallDetails: { llm_tokens_in: totalInputTokens, llm_tokens_out: totalOutputTokens },
  };
}
