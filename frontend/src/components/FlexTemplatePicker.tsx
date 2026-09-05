import { useState } from 'react';
import { useApprovedTemplates, useMyPendingTemplates } from '../api/portfolioTemplates';
import type { TemplateSummary } from '../api/portfolioTemplates';

interface FlexTemplatePickerProps {
  onSelectExisting: (template: TemplateSummary) => void;
  onCreateNew: () => void;
}

// Portfolio Upload - Flex's two template lists (CLAUDE.md's "Portfolio Upload - Flex"
// section): a searchable Approved list (created by Admin/Admin-Master or the logged-in user
// themselves - server-filtered, not a flat shared pool) and a personal Pending-Approval
// dropdown, shown only when the caller actually has one of their own pending. Either list can
// be used to create a portfolio; "Create New Template" starts the mapping wizard instead.
export default function FlexTemplatePicker({ onSelectExisting, onCreateNew }: FlexTemplatePickerProps) {
  const [search, setSearch] = useState('');
  const { data: approved, isLoading: approvedLoading } = useApprovedTemplates(search || undefined);
  const { data: pending } = useMyPendingTemplates();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="flex-template-search" className="mb-1 block text-sm font-medium text-text-primary">
          Existing Template
        </label>
        <input
          id="flex-template-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          data-testid="flex-template-search"
          className="mb-2 w-full rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary sm:w-64"
        />
        {approvedLoading && <p className="text-sm text-text-secondary">Loading templates…</p>}
        {!approvedLoading && approved?.length === 0 && (
          <p className="text-sm text-text-secondary">No approved templates found{search ? ' matching that search' : ''}.</p>
        )}
        <ul className="flex flex-col gap-1">
          {approved?.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectExisting(t)}
                data-testid={`flex-template-option-${t.id}`}
                title={t.howToUseDescription ?? undefined}
                className="w-full rounded-btn border border-border px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-primary"
              >
                {t.templateName}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {pending && pending.length > 0 && (
        <div>
          <label htmlFor="flex-template-pending" className="mb-1 block text-sm font-medium text-text-primary">
            Your Pending Approval Templates
          </label>
          <select
            id="flex-template-pending"
            defaultValue=""
            onChange={(e) => {
              const t = pending.find((p) => p.id === e.target.value);
              if (t) onSelectExisting(t);
            }}
            data-testid="flex-template-pending-select"
            className="w-full rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary sm:w-64"
          >
            <option value="" disabled>Select a pending template…</option>
            {pending.map((t) => <option key={t.id} value={t.id} title={t.howToUseDescription ?? undefined}>{t.templateName}</option>)}
          </select>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onCreateNew}
          data-testid="flex-create-new-template"
          className="rounded-btn border border-dashed border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
        >
          + Create New Template
        </button>
      </div>
    </div>
  );
}
