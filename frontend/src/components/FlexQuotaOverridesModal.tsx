import { useState } from 'react';
import { useUpdateUser, type UpdateUserInput, type UserWithRoles } from '../api/users';
import { ApiError } from '../api/client';

interface FlexQuotaOverridesModalProps {
  user: UserWithRoles;
  onClose: () => void;
}

interface FieldConfig {
  key: 'flexMaxPendingTemplatesOverride' | 'flexMaxApprovedTemplatesOverride' | 'flexMaxPortfoliosOverride';
  label: string;
}

const FIELDS: FieldConfig[] = [
  { key: 'flexMaxPendingTemplatesOverride', label: 'Max Pending-Approval Templates' },
  { key: 'flexMaxApprovedTemplatesOverride', label: 'Max Approved Templates' },
  { key: 'flexMaxPortfoliosOverride', label: 'Max Flex Portfolios' },
];

// Converts the field's local string draft into what the API expects: '' -> null (clear the
// override, fall back to the global default), a valid non-negative integer -> that number.
// Anything else is left to isValidDraft() to reject before this is ever called.
function draftToValue(draft: string): number | null {
  return draft.trim() === '' ? null : Number(draft.trim());
}

function isValidDraft(draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed === '') return true;
  return /^\d+$/.test(trimmed);
}

// Flex Portfolio Quota Limits (Phase 6) - a rare exception action (raising/lowering one user's
// personal override), not routine per-row editing, so it lives in its own pop-up rather than
// crowding UserRolesPage.tsx's already-tight per-row line. Same overlay/panel structure as the
// existing LoginAsModal.tsx.
export default function FlexQuotaOverridesModal({ user, onClose }: FlexQuotaOverridesModalProps) {
  const updateUser = useUpdateUser();
  const [drafts, setDrafts] = useState<Record<FieldConfig['key'], string>>({
    flexMaxPendingTemplatesOverride: user.flexMaxPendingTemplatesOverride?.toString() ?? '',
    flexMaxApprovedTemplatesOverride: user.flexMaxApprovedTemplatesOverride?.toString() ?? '',
    flexMaxPortfoliosOverride: user.flexMaxPortfoliosOverride?.toString() ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const invalidField = FIELDS.find((f) => !isValidDraft(drafts[f.key]));
  const dirty = FIELDS.some((f) => draftToValue(drafts[f.key]) !== user[f.key]);

  async function handleSave() {
    setError(null);
    const fields: Partial<Pick<UpdateUserInput, FieldConfig['key']>> = {};
    for (const f of FIELDS) {
      const value = draftToValue(drafts[f.key]);
      if (value !== user[f.key]) fields[f.key] = value;
    }
    try {
      await updateUser.mutateAsync({ userId: user.id, ...fields });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update Flex quota overrides.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col rounded-card bg-bg-card p-6 shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Flex Quota Overrides</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
          >
            Close
          </button>
        </div>
        <p className="mb-4 text-sm text-text-secondary">{user.email}</p>

        <div className="flex flex-col gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-sm text-text-secondary">{f.label}</span>
              <input
                type="text"
                inputMode="numeric"
                value={drafts[f.key]}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder="Blank = use the global default"
                aria-label={f.label}
                className="rounded-btn border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary"
              />
            </label>
          ))}
        </div>

        {invalidField && (
          <p className="mt-3 text-sm text-danger">{invalidField.label} must be blank or a non-negative whole number.</p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || !!invalidField || updateUser.isPending}
            className="rounded-btn bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {updateUser.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
