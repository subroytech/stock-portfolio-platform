import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import {
  useManagedPortfolios, usePermanentlyDeletePortfolio, useRestorePortfolio,
  type ManagedPortfolio, type ManagedPortfolioType,
} from '../api/portfolioAdmin';
import type { PortfolioStatus } from '../api/portfolios';

// Admin - Portfolio Admin - Manage Portfolio. Every portfolio across all statuses, with single-select
// filters (User, Portfolio Type, Status). The server supplies the default sort (user, type, status,
// name); this page keeps that order when it filters.

const STATUS_OPTIONS: PortfolioStatus[] = ['Active', 'In-Active', 'Soft-Delete'];
const TYPE_OPTIONS: ManagedPortfolioType[] = ['Legacy', 'Flex'];

const PERMANENT_DELETE_WARNING = "All records pertaining to this portfolio will be permanently deleted and can't be recovered.";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ManagePortfolioPage() {
  const { data, isLoading, isError } = useManagedPortfolios();
  const restore = useRestorePortfolio();
  const permanentDelete = usePermanentlyDeletePortfolio();

  const [userFilter, setUserFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | ManagedPortfolioType>('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PortfolioStatus>('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const all = data ?? [];

  // User dropdown options, built from the same list so it only offers users who have portfolios.
  const userOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of all) byId.set(p.ownerUserId, p.ownerEmail);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  // Template dropdown options: every distinct bound template name in the list, A-Z.
  const templateOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of all) if (p.templateName) names.add(p.templateName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [all]);

  const rows = all.filter((p) =>
    (!userFilter || p.ownerUserId === userFilter)
    && (!typeFilter || p.portfolioType === typeFilter)
    && (!templateFilter || p.templateName === templateFilter)
    && (!statusFilter || p.status === statusFilter),
  );

  async function handleRestore(p: ManagedPortfolio) {
    setRowError(null);
    try {
      await restore.mutateAsync(p.id);
    } catch (err) {
      setRowError({ id: p.id, message: errorMessage(err) });
    }
  }

  async function handlePermanentDelete(p: ManagedPortfolio) {
    setRowError(null);
    try {
      await permanentDelete.mutateAsync(p.id);
      setConfirmingId(null);
    } catch (err) {
      setRowError({ id: p.id, message: errorMessage(err) });
    }
  }

  if (isLoading) return <p className="text-sm text-text-secondary">Loading portfolios…</p>;
  if (isError) return <p className="text-sm text-danger">Couldn&rsquo;t load portfolios.</p>;

  const selectClass = 'rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-card bg-bg-card p-4 shadow-card">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          User
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} data-testid="manage-portfolio-filter-user" className={selectClass}>
            <option value="">All</option>
            {userOptions.map(([id, email]) => <option key={id} value={id}>{email}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Portfolio Type
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | ManagedPortfolioType)}
            data-testid="manage-portfolio-filter-type"
            className={selectClass}
          >
            <option value="">All</option>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Portfolio Template
          <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)} data-testid="manage-portfolio-filter-template" className={selectClass}>
            <option value="">All</option>
            {templateOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | PortfolioStatus)}
            data-testid="manage-portfolio-filter-status"
            className={selectClass}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <p className="ml-auto text-xs text-text-muted">{rows.length} of {all.length} portfolios</p>
      </div>

      <div className="overflow-x-auto rounded-card bg-bg-card shadow-card">
        <table className="w-full text-sm" data-testid="manage-portfolio-table">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Portfolio Type</th>
              <th className="px-3 py-2">Portfolio Template</th>
              <th className="px-3 py-2">Portfolio Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-text-secondary">No portfolios match these filters.</td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} data-testid={`managed-portfolio-row-${p.id}`} className="border-b border-border last:border-0 text-text-primary">
                <td className="px-3 py-2">{p.ownerEmail}</td>
                <td className="px-3 py-2">{p.portfolioType}</td>
                <td className="px-3 py-2">{p.templateName ?? '—'}</td>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2">{p.status}</td>
                <td className="px-3 py-2">
                  {p.status === 'Soft-Delete' && (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleRestore(p)}
                        disabled={restore.isPending}
                        aria-label={`Restore ${p.name}`}
                        title="Restore to Active"
                        data-testid={`restore-portfolio-${p.id}`}
                        className="rounded-btn border border-border px-2 py-1 text-text-secondary hover:bg-bg-primary disabled:opacity-60"
                      >
                        <RestoreIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRowError(null); setConfirmingId(p.id); }}
                        aria-label={`Permanently delete ${p.name}`}
                        title="Permanently delete"
                        data-testid={`permanent-delete-portfolio-${p.id}`}
                        className="rounded-btn border border-danger/40 px-2 py-1 text-danger hover:bg-danger/10"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                  {rowError?.id === p.id && <p className="mt-1 text-right text-xs text-danger">{rowError.message}</p>}
                  {confirmingId === p.id && (
                    <div data-testid="permanent-delete-warning" className="mt-2 flex flex-col items-end gap-2 rounded-card border border-danger/40 bg-danger/5 p-3 text-left">
                      <p className="text-xs text-text-primary">{PERMANENT_DELETE_WARNING}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handlePermanentDelete(p)}
                          disabled={permanentDelete.isPending}
                          data-testid="permanent-delete-confirm"
                          className="rounded-btn bg-danger px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {permanentDelete.isPending ? 'Deleting…' : 'Permanently delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="rounded-btn border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
