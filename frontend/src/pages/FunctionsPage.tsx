import { useState, type FormEvent } from 'react';
import { useCreateFunction, useFunctions, useUpdateFunctionStatus, type FunctionStatus } from '../api/functions';
import { ApiError } from '../api/client';

const STATUSES: FunctionStatus[] = ['active', 'inactive', 'Dev-WIP', 'QA-Test'];

// Manage Functions tab content (Admin Console Phase 7, was "View/Manage Functions" through
// Phase 4). activeOnly: false so every row shows regardless of lifecycle status - this
// screen is the one place Dev-WIP/inactive rows are visible (RolePermissionsPage's picker
// hides them). Edit-then-save: each row's status select only updates local draft state
// (draftStatus, keyed by function id) - a per-row "Save" button commits via the existing
// PUT /functions/:id mutation, enabled only once that row's draft differs from its current
// status.
export default function FunctionsPage() {
  const { data: functions, isLoading } = useFunctions({ activeOnly: false });
  const createFunction = useCreateFunction();
  const updateStatus = useUpdateFunctionStatus();
  const [permissionKey, setPermissionKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<FunctionStatus>('Dev-WIP');
  const [statusErrorFor, setStatusErrorFor] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<Record<string, FunctionStatus>>({});
  // Client-side only - the full list is already fetched (activeOnly: false above), so
  // narrowing the view doesn't need a separate request.
  const [filterStatus, setFilterStatus] = useState<FunctionStatus | 'all'>('all');
  const visibleFunctions = functions?.filter((fn) => filterStatus === 'all' || fn.status === filterStatus);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!permissionKey.trim() || !name.trim()) return;
    try {
      await createFunction.mutateAsync({
        permissionKey: permissionKey.trim(),
        name: name.trim(),
        description: description.trim() || null,
        status,
      });
      setPermissionKey('');
      setName('');
      setDescription('');
      setStatus('Dev-WIP');
    } catch {
      // error surfaced via createFunction.isError below
    }
  }

  async function handleSaveStatus(id: string, newStatus: FunctionStatus) {
    setStatusErrorFor(null);
    try {
      await updateStatus.mutateAsync({ id, status: newStatus });
      setDraftStatus((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      setStatusErrorFor(id);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            value={permissionKey}
            onChange={(e) => setPermissionKey(e.target.value)}
            placeholder="permission_key (e.g. reports:export)"
            aria-label="permission_key"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Function name"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          />
        </div>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          aria-label="Function description"
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
        />
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FunctionStatus)}
            aria-label="Initial status"
            className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="submit"
            disabled={createFunction.isPending || !permissionKey.trim() || !name.trim()}
            className="ml-auto rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Create function
          </button>
        </div>
        {createFunction.isError && (
          <p className="text-sm text-danger">
            {createFunction.error instanceof ApiError ? createFunction.error.message : 'Could not create function.'}
          </p>
        )}
      </form>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        Filter by status
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as FunctionStatus | 'all')}
          aria-label="Filter by status"
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
        >
          <option value="all">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {visibleFunctions?.map((fn) => {
          const rowStatus = draftStatus[fn.id] ?? fn.status;
          const dirty = rowStatus !== fn.status;
          return (
            <div key={fn.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bg-card p-3 shadow-card">
              <div>
                <p className="font-medium text-text-primary">{fn.name}</p>
                <p className="text-sm text-text-secondary">{fn.permissionKey}</p>
                {fn.description && <p className="text-sm text-text-secondary">{fn.description}</p>}
                {statusErrorFor === fn.id && (
                  <p className="text-sm text-danger">
                    {updateStatus.error instanceof ApiError ? updateStatus.error.message : 'Could not update status.'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={rowStatus}
                  onChange={(e) => setDraftStatus((prev) => ({ ...prev, [fn.id]: e.target.value as FunctionStatus }))}
                  aria-label={`Status for ${fn.name}`}
                  className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => handleSaveStatus(fn.id, rowStatus)}
                  disabled={!dirty || updateStatus.isPending}
                  className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
