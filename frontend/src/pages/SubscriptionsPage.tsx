import { useState, type FormEvent } from 'react';
import { useDeleteSubscription, useSubscriptions, useUpsertSubscription } from '../api/subscriptions';
import { ApiError } from '../api/client';

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
const PROVIDERS: { id: string; label: string; note: string | null }[] = [
  { id: 'fmp', label: 'FMP (Financial Modeling Prep)', note: null },
  { id: 'finnhub', label: 'Finnhub', note: 'used by Long-Term Analysis for news' },
];

export default function SubscriptionsPage() {
  const { data: subscriptions, isLoading } = useSubscriptions();
  const upsert = useUpsertSubscription();
  const del = useDeleteSubscription();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  const byProvider = new Map((subscriptions ?? []).map((s) => [s.provider, s]));

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
                  onClick={() => { setEditingProvider(provider.id); setApiKey(''); }}
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
                <button type="button" onClick={() => setEditingProvider(null)} className="text-sm text-text-secondary hover:underline">
                  Cancel
                </button>
              </form>
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
