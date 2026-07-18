import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useDeleteSubscription, useSubscriptions, useUpsertSubscription } from '../api/subscriptions';
import { ApiError } from '../api/client';

// FMP is the only provider any backend feature actually consumes today
// (quotes, contrarian-finder, refresh-prices, momentum, stock-preview all
// resolve the caller's own 'fmp' key). Finnhub is a storable provider on the
// backend allowlist but has zero consuming code — noted here rather than
// hidden, so a user doesn't wonder why adding one has no visible effect.
const PROVIDERS = [
  { id: 'fmp', label: 'FMP (Financial Modeling Prep)', active: true },
  { id: 'finnhub', label: 'Finnhub', active: false },
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
    <div className="min-h-screen bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-4 shadow-card sm:px-6">
        <h1 className="text-lg font-semibold text-text-primary">API Keys</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Back to dashboard</Link>
      </header>

      <main className="flex flex-col gap-4 p-4 sm:p-6">
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
                    {!provider.active && (
                      <span className="ml-2 rounded-btn bg-bg-primary px-2 py-0.5 text-xs text-text-muted">
                        not used by any feature yet
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
      </main>
    </div>
  );
}
