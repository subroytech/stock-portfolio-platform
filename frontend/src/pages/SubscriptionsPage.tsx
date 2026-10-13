import { useState, type FormEvent } from 'react';
import { useDeleteSubscription, useListAllowedModels, useSubscriptions, useUpsertSubscription } from '../api/subscriptions';
import { ApiError } from '../api/client';

// "Get Allowed Models" (2026-10-08) only makes sense for providers with a model catalog of
// their own - FMP/Finnhub are data providers, not LLM providers, same restriction the backend
// itself enforces (MODEL_LISTING_PROVIDERS in userSubscription.controller.ts).
const MODEL_LISTING_PROVIDERS = new Set(['anthropic', 'openai']);

// Neither provider's models-list API returns pricing - linking to their own official pricing
// pages is the only way to show cost info that can't silently go stale (a hardcoded $/token
// table in this app's own code would need to be hand-updated every time either provider
// changes pricing or ships a new model, with no way to notice when it drifts).
const PRICING_PAGE_URLS: Record<string, string> = {
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://platform.openai.com/docs/pricing',
};

// My API(s) tab content (Admin Console Phase 7) - also embedded by TabShell's non-admin
// "API Keys" button inside its own small inline modal wrapper (this component itself owns
// no modal chrome, since it now renders in two different contexts - a plain page tab here,
// a modal there).
//
// FMP is required by most features (quotes, contrarian-finder,
// refresh-prices, momentum, stock-preview, long-term-analysis all resolve
// the caller's own 'fmp' key). Finnhub became a real consumed provider
// 2026-07-26 — Long-Term Analysis uses it (optionally) for the news panel,
// the first feature in the platform to actually read a stored Finnhub key.
// Anthropic joined the same bring-your-own + Admin-Master Fallback model used by the two
// above - Candlestick Pattern Q&A's free-text Ask resolves the caller's own 'anthropic' key via
// userSubscription.service.ts's getDecryptedKey(), same as every FMP/Finnhub call site.
// OpenAI joined 2026-10-08 - the ask path's LLM provider is now admin-switchable (Config
// Properties), and whichever provider is selected there resolves its matching key here.
const PROVIDERS: { id: string; label: string; note: string | null }[] = [
  { id: 'fmp', label: 'FMP (Financial Modeling Prep)', note: null },
  { id: 'finnhub', label: 'Finnhub', note: 'used by Long-Term Analysis for news' },
  { id: 'anthropic', label: 'Anthropic (Claude)', note: "used by Candlestick Pattern Q&A's free-text Ask, when the admin-configured provider is Anthropic" },
  { id: 'openai', label: 'OpenAI', note: "used by Candlestick Pattern Q&A's free-text Ask, when the admin-configured provider is OpenAI" },
];

export default function SubscriptionsPage() {
  const { data: subscriptions, isLoading } = useSubscriptions();
  const upsert = useUpsertSubscription();
  const del = useDeleteSubscription();
  const listModels = useListAllowedModels();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  const byProvider = new Map((subscriptions ?? []).map((s) => [s.provider, s]));

  function startEditing(providerId: string) {
    setEditingProvider(providerId);
    setApiKey('');
    listModels.reset();
  }

  function handleGetAllowedModels(provider: string) {
    if (!apiKey.trim()) return;
    listModels.mutate({ provider, apiKey: apiKey.trim() });
  }

  function handleCheckSavedKey(provider: string) {
    listModels.mutate({ provider, useSavedKey: true });
  }

  async function handleSubmit(e: FormEvent, provider: string) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    await upsert.mutateAsync({ provider, apiKey: apiKey.trim() });
    setApiKey('');
    setEditingProvider(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {PROVIDERS.map((provider) => {
        const sub = byProvider.get(provider.id);
        const isEditing = editingProvider === provider.id;

        return (
          <div key={provider.id} className="rounded-card bg-bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">
                  {provider.label}
                  {provider.note && (
                    <span className="ml-2 rounded-btn bg-bg-primary px-2 py-0.5 text-xs text-text-muted">
                      {provider.note}
                    </span>
                  )}
                </p>
                <p className="text-sm text-text-secondary">
                  {sub ? `Key on file: ${sub.maskedKey}` : 'No key on file.'}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(provider.id)}
                  className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
                >
                  {sub ? 'Update key' : 'Add key'}
                </button>
                {sub && (
                  <button
                    type="button"
                    onClick={() => del.mutate(provider.id)}
                    className="rounded-btn border border-border px-3 py-1.5 text-sm text-danger hover:bg-bg-primary"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {isEditing && (
              <form onSubmit={(e) => handleSubmit(e, provider.id)} className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoFocus
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your API key"
                  className="flex-1 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
                />
                <button type="submit" disabled={upsert.isPending} className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover">
                  Save
                </button>
                {MODEL_LISTING_PROVIDERS.has(provider.id) && (
                  <button
                    type="button"
                    disabled={listModels.isPending || !apiKey.trim()}
                    onClick={() => handleGetAllowedModels(provider.id)}
                    data-testid={`get-allowed-models-${provider.id}`}
                    className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary disabled:opacity-60"
                  >
                    {listModels.isPending ? 'Checking…' : 'Get Allowed Models'}
                  </button>
                )}
                {MODEL_LISTING_PROVIDERS.has(provider.id) && sub && (
                  <button
                    type="button"
                    disabled={listModels.isPending}
                    onClick={() => handleCheckSavedKey(provider.id)}
                    data-testid={`check-saved-key-${provider.id}`}
                    title="Check allowed models for the key already on file, without retyping it"
                    className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary disabled:opacity-60"
                  >
                    {listModels.isPending ? 'Checking…' : 'Check Saved Key'}
                  </button>
                )}
                <button type="button" onClick={() => { setEditingProvider(null); listModels.reset(); }} className="text-sm text-text-secondary hover:underline">
                  Cancel
                </button>
              </form>
            )}

            {isEditing && listModels.isSuccess && (
              <div className="mt-3 rounded-btn border border-border bg-bg-primary p-3" data-testid={`allowed-models-result-${provider.id}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">
                    {listModels.data.length} model{listModels.data.length === 1 ? '' : 's'} available to this key
                  </p>
                  {PRICING_PAGE_URLS[provider.id] && (
                    <a
                      href={PRICING_PAGE_URLS[provider.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      View {provider.label} pricing ↗
                    </a>
                  )}
                </div>
                <p className="mb-2 text-xs text-text-muted">
                  Costs aren't returned by {provider.label}'s API - see the pricing link above for current rates per model.
                </p>
                <ul className="max-h-48 list-none overflow-y-auto font-mono text-xs text-text-secondary">
                  {listModels.data.map((model) => (
                    <li key={model} className="border-b border-border py-1 last:border-0">{model}</li>
                  ))}
                </ul>
              </div>
            )}
            {isEditing && listModels.isError && (
              <p className="mt-2 text-sm text-danger" data-testid={`allowed-models-error-${provider.id}`}>
                {listModels.error instanceof ApiError ? listModels.error.message : 'Could not check this key.'}
              </p>
            )}

            {upsert.isError && editingProvider === provider.id && (
              <p className="mt-2 text-sm text-danger">
                {upsert.error instanceof ApiError ? upsert.error.message : 'Could not save the key.'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
