import { useState, type FormEvent } from 'react';
import { useCreateRole, useDeleteRole, useRoles } from '../api/roles';
import { ApiError } from '../api/client';

// Manage Role tab content (Admin Console Phase 7, was "View/Create Role" through Phase 3).
// Name only for creation - no rename this pass. Delete is blocked (server-side, the real
// guard) while any user still holds the role.
export default function RolesPage() {
  const { data: roles, isLoading } = useRoles();
  const createRole = useCreateRole();
  const deleteRole = useDeleteRole();
  const [name, setName] = useState('');
  const [deleteErrorFor, setDeleteErrorFor] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createRole.mutateAsync(name.trim());
      setName('');
    } catch {
      // error surfaced via createRole.isError below
    }
  }

  async function handleDelete(roleId: string) {
    setDeleteErrorFor(null);
    try {
      await deleteRole.mutateAsync(roleId);
    } catch {
      setDeleteErrorFor(roleId);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New role name"
          aria-label="New role name"
          className="flex-1 rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
        />
        <button
          type="submit"
          disabled={createRole.isPending || !name.trim()}
          className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
        >
          Create role
        </button>
      </form>

      {createRole.isError && (
        <p className="text-sm text-danger">
          {createRole.error instanceof ApiError ? createRole.error.message : 'Could not create role.'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {roles?.map((role) => (
          <div key={role.id} className="flex items-center justify-between gap-3 rounded-card bg-bg-card p-3 shadow-card">
            <div>
              <p className="font-medium text-text-primary">{role.name}</p>
              <p className="text-sm text-text-secondary">{role.userCount} user{role.userCount === 1 ? '' : 's'}</p>
              {deleteErrorFor === role.id && (
                <p className="text-sm text-danger">
                  {deleteRole.error instanceof ApiError ? deleteRole.error.message : 'Could not delete role.'}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleDelete(role.id)}
              disabled={role.userCount > 0 || deleteRole.isPending}
              title={role.userCount > 0 ? 'Cannot delete a role that is still assigned to a user.' : undefined}
              className="rounded-btn border border-border px-3 py-1.5 text-sm text-danger hover:bg-bg-primary disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
