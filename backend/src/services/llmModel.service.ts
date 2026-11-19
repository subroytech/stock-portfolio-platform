// Provider-agnostic LLM model factory - replaces anthropicClient.service.ts (2026-10-08).
// A thin wrapper, same scope/reasoning as the file it replaces: all business logic (tool
// design, the search/answer loop) lives in candlestickQuestionAnswerAsk.service.ts, so a
// provider swap stays contained here plus that file's own call sites.
//
// apiKey is resolved per-caller by userSubscription.service.ts's getDecryptedKey() (bring-your-
// own + Admin-Master Fallback) and passed in on every call - no cached singleton client, since
// different users (and different admin-configured providers) can resolve to different keys.
// Constructing a provider instance is cheap (it just wraps fetch), same reasoning
// anthropicClient.service.ts/marketData.service.ts already relied on.

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type LlmProvider = 'anthropic' | 'openai';

export function getLanguageModel(provider: LlmProvider, apiKey: string, modelId: string): LanguageModel {
  if (provider === 'openai') return createOpenAI({ apiKey })(modelId);
  return createAnthropic({ apiKey })(modelId);
}
