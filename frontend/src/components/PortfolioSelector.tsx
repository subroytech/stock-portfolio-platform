import { useState, type FormEvent } from 'react';
import { useCreatePortfolio, usePortfolios, useSoftDeletePortfolio, useUpdatePortfolio, type PortfolioSummary } from '../api/portfolios';
import { ApiError } from '../api/client';
import SoftDeleteConfirm from './SoftDeleteConfirm';

interface PortfolioSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section) - TabShell's
  // Legacy sub-tab passes `p => p.flexTemplateStatus === null` so a Flex-created portfolio
  // (bound to a template) never shows up here, where UploadImportDialog's header-alias
  // guessing would silently overwrite it with data that no longer matches its bound mapping.
  // Omitted (default: show everything) everywhere else - unchanged from before this filter
  // existed.
  filter?: (p: PortfolioSummary) => boolean;
}

export default function PortfolioSelector({ selectedId, onSelect, filter }: PortfolioSelectorProps) {
  const { data: allPortfolios, isLoading } = usePortfolios();
  const portfolios = filter ? allPortfolios?.filter(filter) : allPortfolios;
  const createPortfolio = useCreatePortfolio();
  const updatePortfolio = useUpdatePortfolio();
  const softDeletePortfolio = useSoftDeletePortfolio();
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Set when the trash icon in the edit form is clicked - shows the warning until the user confirms or cancels.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Soft-delete: hides the portfolio from the owner's list (nothing is removed). Only an admin can
  // restore it. Moves the selection to another portfolio, or clears it if none are left.
  async function handleSoftDelete(id: string) {
    await softDeletePortfolio.mutateAsync(id);
    const remaining = (portfolios ?? []).filter((p) => p.id !== id);
    setConfirmDeleteId(null);
    setEditingId(null);
    if (selectedId === id) onSelect(remaining[0]?.id ?? '');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const portfolio = await createPortfolio.mutateAsync({ name: newName.trim() });
    setNewName('');
    setShowCreate(false);
    onSelect(portfolio.id);
  }

  function startEditing(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    if (!editingId || !editName.trim()) return;
    await updatePortfolio.mutateAsync({ id: editingId, name: editName.trim() });
    setEditingId(null);
  }

  if (isLoading) return <p className="text-sm text-text-secondary">Loading portfolios…</p>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {portfolios?.map((p) => (
        editingId === p.id ? (
          <form key={p.id} onSubmit={handleRename} className="flex items-center gap-1">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
            <button type="submit" disabled={updatePortfolio.isPending} className="rounded-btn bg-accent px-2 py-1.5 text-sm text-white hover:bg-accent-hover">
              Save
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-sm text-text-secondary hover:underline">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(p.id)}
              aria-label={`Delete ${p.name}`}
              title="Delete portfolio"
              data-testid={`delete-portfolio-${p.id}`}
              className="rounded-btn border border-danger/40 px-2 py-1.5 text-danger hover:bg-danger/10"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {updatePortfolio.isError && updatePortfolio.variables?.id === p.id && (
              <span className="text-xs text-danger">
                {updatePortfolio.error instanceof ApiError ? updatePortfolio.error.message : 'Could not rename.'}
              </span>
            )}
          </form>
        ) : (
          <span
            key={p.id}
            className={`group flex items-center gap-1 rounded-btn px-1 text-sm transition-colors ${
              p.id === selectedId
                ? 'bg-accent text-white'
                : 'border border-border text-text-secondary hover:bg-bg-primary'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              className="px-2 py-1.5"
            >
              {p.name}
            </button>
            <button
              type="button"
              onClick={() => startEditing(p.id, p.name)}
              aria-label={`Rename ${p.name}`}
              className={`px-1.5 py-1.5 opacity-60 hover:opacity-100 ${p.id === selectedId ? 'text-white' : 'text-text-secondary'}`}
            >
              ✎
            </button>
          </span>
        )
      ))}

      {confirmDeleteId && (() => {
        const target = portfolios?.find((p) => p.id === confirmDeleteId);
        if (!target) return null;
        return (
          <SoftDeleteConfirm
            name={target.name}
            isPending={softDeletePortfolio.isPending}
            errorMessage={softDeletePortfolio.isError
              ? (softDeletePortfolio.error instanceof ApiError ? softDeletePortfolio.error.message : 'Could not delete the portfolio.')
              : null}
            onConfirm={() => handleSoftDelete(target.id)}
            onCancel={() => setConfirmDeleteId(null)}
          />
        );
      })()}

      {showCreate ? (
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Portfolio name"
            data-testid="new-portfolio-name-input"
            className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
          />
          <button type="submit" disabled={createPortfolio.isPending} data-testid="new-portfolio-submit" className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover">
            Add
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-text-secondary hover:underline">
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          data-testid="new-portfolio-button"
          className="rounded-btn border border-dashed border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
        >
          + New portfolio
        </button>
      )}
    </div>
  );
}
