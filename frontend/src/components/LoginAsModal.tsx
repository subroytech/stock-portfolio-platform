import { useState } from 'react';
import { useUsersWithRoles } from '../api/users';
import { useImpersonate } from '../api/auth';
import { ApiError } from '../api/client';

interface LoginAsModalProps {
  onClose: () => void;
  onImpersonated: () => void;
}

// "Login-as" (CLAUDE.md's "Login-as" section) - reuses the existing Manage Users list
// (api/users.ts's useUsersWithRoles, already gated by users:manage_roles - confirmed
// admin-master already holds that permission, so no new list endpoint needed) instead of
// building a dedicated one. One explicit confirm step before actually switching identity, same
// pattern as every other impactful action in this Admin Console.
export default function LoginAsModal({ onClose, onImpersonated }: LoginAsModalProps) {
  const { data: users, isLoading } = useUsersWithRoles();
  const [search, setSearch] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const impersonate = useImpersonate();

  const filtered = (users ?? []).filter((u) => u.email.toLowerCase().includes(search.trim().toLowerCase()));

  async function handleLoginAs(userId: string) {
    try {
      await impersonate.mutateAsync(userId);
      onImpersonated();
    } catch {
      // surfaced below via impersonate.isError
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-card bg-bg-card p-6 shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Login as User</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
          >
            Close
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          data-testid="login-as-search"
          className="mb-4 rounded-btn border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
        />

        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {!isLoading && filtered.length === 0 && <p className="text-sm text-text-secondary">No matching users.</p>}

        <ul className="flex flex-col gap-2 overflow-y-auto" data-testid="login-as-list">
          {filtered.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-text-primary">{u.email}</p>
                <p className="text-xs text-text-muted">{u.roles.join(', ') || 'no roles'}</p>
              </div>
              {confirmingId !== u.id ? (
                <button
                  type="button"
                  onClick={() => setConfirmingId(u.id)}
                  data-testid={`login-as-${u.id}`}
                  className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
                >
                  Login as
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-muted">Log in as this user? You can return to your own account at any time.</span>
                  <button
                    type="button"
                    onClick={() => handleLoginAs(u.id)}
                    disabled={impersonate.isPending}
                    data-testid={`login-as-confirm-${u.id}`}
                    className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {impersonate.isPending ? 'Logging in…' : 'Confirm'}
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)} className="text-sm text-text-secondary hover:underline">
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {impersonate.isError && (
          <p className="mt-2 text-sm text-danger">
            {impersonate.error instanceof ApiError ? impersonate.error.message : 'Could not log in as this user.'}
          </p>
        )}
      </div>
    </div>
  );
}
