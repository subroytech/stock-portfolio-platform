// Thin wrapper around the Anthropic SDK's Messages API - the platform's first LLM integration
// (see Requirements/Candlestick-Pattern-Q&A-Module-Requirements.md). Scoped purely to making the
// call; all business logic (tool design, the search/answer loop) lives in
// candlestickQuestionAnswerAsk.service.ts, so a provider swap later stays contained to this one
// file plus that file's own call sites.
//
// apiKey is resolved per-caller by userSubscription.service.ts's getDecryptedKey() (bring-your-
// own + Admin-Master Fallback, same as every FMP/Finnhub call site) and passed in on every call -
// no cached singleton client, since different users can have different keys. Constructing the
// SDK wrapper is cheap (it just wraps fetch, no connection to amortize), the same reasoning
// marketData.service.ts's getQuotes(symbols, apiKey) already relies on for FMP.

import Anthropic from '@anthropic-ai/sdk';

export async function createMessage(
  apiKey: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  return new Anthropic({ apiKey }).messages.create(params);
}
