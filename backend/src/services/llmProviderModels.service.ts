// "Get Allowed Models" (My API(s) page, 2026-10-08) - lets a user see which models a given
// Anthropic/OpenAI key actually has access to, before (or instead of) saving it. Deliberately
// plain fetch() calls, not the Anthropic/OpenAI SDKs - this is a one-off catalog lookup, not a
// generation call, and neither provider's SDK is otherwise needed just for this.
//
// Costs nothing to call (no tokens, no generation) - both are plain account/catalog endpoints.

export type LlmProvider = 'anthropic' | 'openai';

export class ProviderModelListError extends Error {
  constructor(public readonly provider: LlmProvider, public readonly status: number) {
    super(`The API key was rejected by ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} (HTTP ${status}).`);
  }
}

interface OpenAIModelListResponse {
  data: { id: string }[];
}

async function listOpenAIModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new ProviderModelListError('openai', res.status);
  const body = (await res.json()) as OpenAIModelListResponse;
  return body.data.map((m) => m.id).sort();
}

interface AnthropicModelListResponse {
  data: { id: string }[];
}

async function listAnthropicModels(apiKey: string): Promise<string[]> {
  // Anthropic's own endpoint paginates (has_more/last_id) - not handled here, since the full
  // catalog is small enough to fit comfortably within one page's default limit. Would need a
  // follow-up fetch loop if that ever stops being true.
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  if (!res.ok) throw new ProviderModelListError('anthropic', res.status);
  const body = (await res.json()) as AnthropicModelListResponse;
  return body.data.map((m) => m.id).sort();
}

export async function listModelsForProvider(provider: LlmProvider, apiKey: string): Promise<string[]> {
  return provider === 'openai' ? listOpenAIModels(apiKey) : listAnthropicModels(apiKey);
}
