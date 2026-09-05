import { useEffect, useMemo, useState } from 'react';
import { useRoles, useRolePermissions, useGrantPermission, useRevokePermission } from '../api/roles';
import { useFunctions, type FunctionMasterRow } from '../api/functions';
import { ApiError } from '../api/client';

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

// Display-only mirror of the backend's roles.service.ts PERMISSION_REQUIRES map -
// contrarian_finder:scan_history only means anything alongside contrarian_finder:scan (see
// that file's comment), so this just controls how they're grouped/indented here. The backend
// remains the sole source of truth for actually enforcing the dependency (grant/revoke both
// reject an attempt to violate it) - if this map ever drifts out of sync with the backend's,
// the worst case is a display-only nesting glitch, never a bypass of the real guard.
const PERMISSION_PARENT: Record<string, string> = {
  'contrarian_finder:scan_history': 'contrarian_finder:scan',
};

// Reorders the flat (alphabetical-by-name) function list so a child permission renders
// directly under its parent instead of wherever its own name would otherwise sort it - e.g.
// "Contrarian Finder Scan History" (C...) would otherwise land well before, not after,
// "Run Contrarian Finder Scan" (R...). Falls back to a normal top-level (depth 0) row if a
// declared parent isn't present in this list (e.g. filtered out by activeOnly).
function withParentChildOrder(functions: FunctionMasterRow[]): (FunctionMasterRow & { depth: number })[] {
  const byKey = new Map(functions.map((fn) => [fn.permissionKey, fn]));
  const childrenByParent = new Map<string, FunctionMasterRow[]>();
  const topLevel: FunctionMasterRow[] = [];

  for (const fn of functions) {
    const parentKey = PERMISSION_PARENT[fn.permissionKey];
    if (parentKey && byKey.has(parentKey)) {
      const siblings = childrenByParent.get(parentKey) ?? [];
      siblings.push(fn);
      childrenByParent.set(parentKey, siblings);
    } else {
      topLevel.push(fn);
    }
  }

  return topLevel.flatMap((fn) => [
    { ...fn, depth: 0 },
    ...(childrenByParent.get(fn.permissionKey) ?? []).map((child) => ({ ...child, depth: 1 })),
  ]);
}

// Manage Permission tab content (Admin Console Phase 7, was "View/Edit Permission" through
// Phase 3). Edit-then-save: checkboxes only toggle local draft state; one "Save" button
// diffs the draft against the last-fetched set and fires exactly the grant/revoke calls
// needed - no new backend endpoint, this just batches the existing single-key grant/revoke
// routes behind one click instead of firing on every checkbox change. The picker is a fixed
// set of checkboxes sourced from GET /functions (active+QA-Test only, see api/functions.ts),
// not free text - the FK on m_role_permissions.permission_key (migration 016) is the
// DB-enforced backstop for the same guarantee.
export default function RolePermissionsPage() {
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const { data: permissions, isLoading: permissionsLoading, refetch } = useRolePermissions(selectedRoleId);
  const { data: functions, isLoading: functionsLoading } = useFunctions();
  const orderedFunctions = useMemo(() => withParentChildOrder(functions ?? []), [functions]);
  const grant = useGrantPermission(selectedRoleId ?? '');
  const revoke = useRevokePermission(selectedRoleId ?? '');
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(null); // clear while the newly selected role's permissions load
  }, [selectedRoleId]);

  useEffect(() => {
    if (permissions) setDraft(new Set(permissions));
  }, [permissions]);

  function handleToggle(permissionKey: string, checked: boolean) {
    setDraft((prev) => {
      const next = new Set(prev ?? []);
      if (checked) next.add(permissionKey);
      else next.delete(permissionKey);
      return next;
    });
  }

  const original = new Set(permissions ?? []);
  const isDirty = draft !== null && !setsEqual(draft, original);

  async function handleSave() {
    if (!draft || !selectedRoleId) return;
    setError(null);
    setSaving(true);
    const toGrant = [...draft].filter((k) => !original.has(k));
    const toRevoke = [...original].filter((k) => !draft.has(k));
    try {
      await Promise.all([
        ...toGrant.map((k) => grant.mutateAsync(k)),
        ...toRevoke.map((k) => revoke.mutateAsync(k)),
      ]);
      await refetch(); // authoritative re-sync, avoids trusting per-call cache-write ordering
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save permissions.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-text-secondary">
        Role
        <select
          value={selectedRoleId ?? ''}
          onChange={(e) => setSelectedRoleId(e.target.value || null)}
          disabled={rolesLoading}
          className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-text-primary"
        >
          <option value="">Select a role…</option>
          {roles?.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      {selectedRoleId && (
        <>
          <div className="flex flex-col gap-2">
            {(permissionsLoading || functionsLoading || draft === null) && <p className="text-sm text-text-secondary">Loading…</p>}
            {draft !== null && orderedFunctions.map((fn) => (
              <label
                key={fn.permissionKey}
                className="flex items-center gap-3 rounded-card bg-bg-card p-3 shadow-card"
                style={fn.depth > 0 ? { marginLeft: `${fn.depth * 1.75}rem` } : undefined}
              >
                <input
                  type="checkbox"
                  checked={draft.has(fn.permissionKey)}
                  onChange={(e) => handleToggle(fn.permissionKey, e.target.checked)}
                />
                <div>
                  <p className="font-medium text-text-primary">
                    {fn.depth > 0 && <span className="mr-1 text-text-secondary">↳</span>}
                    {fn.name}
                  </p>
                  {fn.description && <p className="text-sm text-text-secondary">{fn.description}</p>}
                </div>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="self-start rounded-btn bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}
