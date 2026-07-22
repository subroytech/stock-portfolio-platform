import { useState, type FormEvent } from 'react';
import { useCreatePortfolio, usePortfolios, useUpdatePortfolio } from '../api/portfolios';
import { ApiError } from '../api/client';

interface PortfolioSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function PortfolioSelector({ selectedId, onSelect }: PortfolioSelectorProps) {
  const { data: portfolios, isLoading } = usePortfolios();
  const createPortfolio = useCreatePortfolio();
  const updatePortfolio = useUpdatePortfolio();
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

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
