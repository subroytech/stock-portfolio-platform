import { useState } from 'react';
import {
  useAllTemplates, useTemplateDetail, useSetTemplateStatus, useDeleteTemplate,
  useBoundPortfolios, useDeleteBoundPortfolio, useSoftDeleteBoundPortfolio,
  useUnattachedFlexPortfolios, useDeleteUnattachedFlexPortfolio, TARGET_FIELD_LABELS,
  type TemplateStatus,
} from '../api/portfolioTemplates';
import { ApiError } from '../api/client';
import { formatCurrency, formatDateTime24 } from '../lib/format';

const STATUS_STYLES: Record<string, string> = {
  'Pending Approval': 'bg-warning/10 text-warning',
  Approved: 'bg-success/10 text-success',
  Rejected: 'bg-danger/10 text-danger',
};

const ALL_STATUSES: TemplateStatus[] = ['Pending Approval', 'Approved', 'Rejected'];

// Expander panel under a template row (2026-11-15): every portfolio created from this template, across
// all statuses, with what an admin needs to judge them. Loaded only when the row is expanded.
function TemplatePortfolioList({ templateId }: { templateId: string }) {
  const { data: portfolios, isLoading, isError } = useBoundPortfolios(templateId);
  if (isLoading) return <p className="text-xs text-text-secondary">Loading portfolios…</p>;
  if (isError) return <p className="text-xs text-danger">Couldn&rsquo;t load the portfolios for this template.</p>;
  if (!portfolios || portfolios.length === 0) {
    return <p className="text-xs text-text-secondary">No portfolios have been created from this template yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-btn border border-border">
      <table className="w-full text-xs" data-testid={`template-portfolios-${templateId}`}>
        <thead>
          <tr className="border-b border-border text-left text-text-secondary">
            <th className="px-2 py-1">Owner</th>
            <th className="px-2 py-1">Portfolio</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Created</th>
            <th className="px-2 py-1">Last Updated</th>
            <th className="px-2 py-1 text-right">Holdings</th>
            <th className="px-2 py-1 text-right">Market Value</th>
          </tr>
        </thead>
        <tbody>
          {portfolios.map((p) => (
            <tr key={p.id} data-testid={`template-portfolio-row-${p.id}`} className="border-b border-border last:border-0 text-text-primary">
              <td className="px-2 py-1">{p.ownerEmail}</td>
              <td className="px-2 py-1 font-medium">{p.name}</td>
              <td className="px-2 py-1">{p.status}</td>
              <td className="px-2 py-1 whitespace-nowrap">{formatDateTime24(p.createdAt)}</td>
              <td className="px-2 py-1 whitespace-nowrap">{formatDateTime24(p.updatedAt)}</td>
              <td className="px-2 py-1 text-right">{p.holdingsCount}</td>
              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(p.marketValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BoundPortfoliosModalProps {
  templateId: string;
  deleteTemplate: ReturnType<typeof useDeleteTemplate>;
  onDeleteTemplate: () => void;
  onClose: () => void;
}

// Shown when Delete 409s because the template is still bound to one or more portfolios (see
// CLAUDE.md's "Portfolio Template delete" note - resolves by deleting the specific blocking
// portfolios one at a time, an explicit admin action, never a silent cascade). Once the list
// empties, deleteTemplate() (unchanged) simply succeeds on its own existing 0-references path.
function BoundPortfoliosModal({ templateId, deleteTemplate, onDeleteTemplate, onClose }: BoundPortfoliosModalProps) {
  const { data: portfolios, isLoading } = useBoundPortfolios(templateId);
  const deleteBoundPortfolio = useDeleteBoundPortfolio(templateId);
  const softDeleteBoundPortfolio = useSoftDeleteBoundPortfolio(templateId);
  // The row showing its confirm step. 'soft' is for an Active portfolio, 'permanent' for a Soft-Delete one.
  const [confirming, setConfirming] = useState<{ id: string; action: 'soft' | 'permanent' } | null>(null);
  const actionError = deleteBoundPortfolio.isError ? deleteBoundPortfolio.error
    : softDeleteBoundPortfolio.isError ? softDeleteBoundPortfolio.error
    : null;

  async function handlePermanentDelete(id: string) {
    try {
      await deleteBoundPortfolio.mutateAsync(id);
      setConfirming(null);
    } catch {
      // surfaced below via actionError
    }
  }

  async function handleSoftDelete(id: string) {
    try {
      await softDeleteBoundPortfolio.mutateAsync(id);
      setConfirming(null);
    } catch {
      // surfaced below via actionError
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-card bg-bg-card p-6 shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Bound Portfolios</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
          >
            Close
          </button>
        </div>

        <p className="mb-4 text-sm text-text-secondary">
          This template can't be deleted while a portfolio is still bound to it. Soft-delete any active portfolio below,
          then permanently delete it, to free the template.
        </p>

        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

        {portfolios && portfolios.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2 overflow-y-auto" data-testid="bound-portfolios-list">
            {portfolios.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-text-primary">{p.name}</p>
                  <p className="text-xs text-text-muted">{p.ownerEmail}</p>
                  <p className="text-xs text-text-secondary" data-testid={`bound-portfolio-status-${p.id}`}>{p.status}</p>
                </div>
                {confirming?.id !== p.id ? (
                  p.status === 'Soft-Delete' ? (
                    <button
                      type="button"
                      onClick={() => setConfirming({ id: p.id, action: 'permanent' })}
                      data-testid={`bound-portfolio-delete-${p.id}`}
                      className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming({ id: p.id, action: 'soft' })}
                      data-testid={`bound-portfolio-soft-delete-${p.id}`}
                      className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
                    >
                      Soft-Delete
                    </button>
                  )
                ) : confirming.action === 'permanent' ? (
                  <div className="flex w-full flex-col gap-2">
                    <p className="text-xs text-danger">
                      All records pertaining to this portfolio will be permanently deleted and can't be recovered.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePermanentDelete(p.id)}
                        disabled={deleteBoundPortfolio.isPending}
                        data-testid={`bound-portfolio-delete-confirm-${p.id}`}
                        className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {deleteBoundPortfolio.isPending ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-sm text-text-secondary hover:underline">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex w-full flex-col gap-2">
                    <p className="text-xs text-text-secondary">
                      This hides the portfolio from its owner. It can then be permanently deleted from this pop-up.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSoftDelete(p.id)}
                        disabled={softDeleteBoundPortfolio.isPending}
                        data-testid={`bound-portfolio-soft-delete-confirm-${p.id}`}
                        className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
                      >
                        {softDeleteBoundPortfolio.isPending ? 'Soft-deleting…' : 'Confirm Soft-Delete'}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-sm text-text-secondary hover:underline">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {actionError && (
          <p className="mb-4 text-sm text-danger">
            {actionError instanceof ApiError ? actionError.message : 'Could not update this portfolio.'}
          </p>
        )}

        {portfolios && portfolios.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-success">All bound portfolios removed.</p>
            <button
              type="button"
              onClick={onDeleteTemplate}
              disabled={deleteTemplate.isPending}
              data-testid="bound-portfolios-delete-template"
              className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
            >
              {deleteTemplate.isPending ? 'Deleting…' : 'Delete Template'}
            </button>
            {deleteTemplate.isError && (
              <p className="text-sm text-danger">
                {deleteTemplate.error instanceof ApiError ? deleteTemplate.error.message : 'Could not delete this template.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The other half of this screen's template-health concern: Flex portfolios stuck in
// 'Flex-Err' (the owning user created them via Flex but never completed Save Template or
// Delete Portfolio) - otherwise visible to no one but that one user, forever, if abandoned.
// Deliberately inside this same page (not a separate Admin Console menu item) - same
// underlying concern as the template list above it, just the other direction (portfolios with
// no template, instead of templates with bound portfolios).
function UnattachedFlexPortfoliosSection() {
  const { data: portfolios, isLoading } = useUnattachedFlexPortfolios();
  const deleteUnattached = useDeleteUnattachedFlexPortfolio();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setErrorFor(null);
    try {
      await deleteUnattached.mutateAsync(id);
      setConfirmingId(null);
    } catch {
      setErrorFor(id);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <h2 className="mb-1 text-sm font-semibold text-text-primary">Unattached Flex Portfolios</h2>
      <p className="mb-3 text-xs text-text-muted">
        Created via Flex, but never resolved (Save Template or Delete Portfolio) by their owner - otherwise invisible to anyone else.
      </p>
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {!isLoading && portfolios?.length === 0 && <p className="text-sm text-text-secondary">No unattached Flex portfolios.</p>}
      <div className="flex flex-col gap-2">
        {portfolios?.map((p) => (
          <div key={p.id} className="rounded-card bg-bg-card p-3 shadow-card" data-testid={`unattached-portfolio-${p.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{p.name}</p>
                <p className="text-xs text-text-muted">
                  {p.ownerEmail} · {p.holdingsCount} holding{p.holdingsCount === 1 ? '' : 's'} · {formatCurrency(p.cashAmount)} cash
                </p>
              </div>
              <div className="flex items-center gap-2">
                {confirmingId !== p.id ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(p.id)}
                    data-testid={`unattached-portfolio-delete-${p.id}`}
                    className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
                  >
                    Delete
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      disabled={deleteUnattached.isPending}
                      data-testid={`unattached-portfolio-delete-confirm-${p.id}`}
                      className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {deleteUnattached.isPending ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)} className="text-sm text-text-secondary hover:underline">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
            {errorFor === p.id && (
              <p className="mt-1 text-sm text-danger">
                {deleteUnattached.error instanceof ApiError ? deleteUnattached.error.message : 'Could not delete this portfolio.'}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Portfolio Upload - Flex's admin approval mechanism (CLAUDE.md's "Portfolio Upload - Flex"
// section) - the entire governance loop for user-created templates. Lists every template
// regardless of status/creator; expanding a row shows its mapping + sample_preview (so an
// admin can judge a Pending template without needing the original file) via GET
// /portfolio-templates/:id, which only this permission (portfolio_template:manage_status) can
// reach.
export default function PortfolioTemplateApprovalPage() {
  const { data: templates, isLoading } = useAllTemplates();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Separate from expandedId (the mapping detail): which template row has its portfolio list open (2026-11-15).
  const [portfoliosOpenId, setPortfoliosOpenId] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading } = useTemplateDetail(expandedId);
  const setStatus = useSetTemplateStatus();
  const deleteTemplate = useDeleteTemplate();
  const [actionErrorFor, setActionErrorFor] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Set when a Delete attempt 409s because the template is still bound to a portfolio -
  // opens the BoundPortfoliosModal instead of just leaving a plain error message, since that's
  // an actionable next step, not a dead end.
  const [boundPortfoliosModalFor, setBoundPortfoliosModalFor] = useState<string | null>(null);

  // Filter by Name/Status/Created By (requirement: "make it user friendly to filter by all 3
  // fields") - client-side, same pattern as UserRolesPage.tsx's emailFilter/statusFilter/
  // roleFilter, since the full list is already fetched.
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | 'all'>('all');
  const [createdByFilter, setCreatedByFilter] = useState('');
  const visibleTemplates = templates?.filter((t) => {
    if (nameFilter.trim() && !t.templateName.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (createdByFilter.trim() && !(t.createdByEmail ?? '').toLowerCase().includes(createdByFilter.trim().toLowerCase())) return false;
    return true;
  });

  async function handleSetStatus(id: string, status: 'Approved' | 'Rejected') {
    setActionErrorFor(null);
    try {
      await setStatus.mutateAsync({ id, status });
    } catch {
      setActionErrorFor(id);
    }
  }

  async function handleDelete(id: string) {
    setActionErrorFor(null);
    try {
      await deleteTemplate.mutateAsync(id);
      setConfirmingDeleteId(null);
      setBoundPortfoliosModalFor(null);
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      setConfirmingDeleteId(null);
      // Only TEMPLATE_IN_USE opens the pop-up. An Approved template is also refused with a 409, but
      // for a different reason - that case shows the server's message (reject it first) instead.
      const inUse = err instanceof ApiError && err.status === 409
        && (err.body as { code?: string } | null)?.code === 'TEMPLATE_IN_USE';
      if (inUse) {
        setBoundPortfoliosModalFor(id);
      } else {
        setActionErrorFor(id);
      }
    }
  }

  return (
    <>
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-card bg-bg-secondary px-3 py-2">
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Search template name…"
          aria-label="Filter by template name"
          className="min-w-0 flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TemplateStatus | 'all')}
          aria-label="Filter by status"
          className="rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
        >
          <option value="all">Status: All</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          value={createdByFilter}
          onChange={(e) => setCreatedByFilter(e.target.value)}
          placeholder="Search created by…"
          aria-label="Filter by created by"
          className="min-w-0 flex-1 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
        />
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {!isLoading && templates?.length === 0 && <p className="text-sm text-text-secondary">No portfolio templates have been created yet.</p>}
      {!isLoading && (templates?.length ?? 0) > 0 && visibleTemplates?.length === 0 && (
        <p className="text-sm text-text-secondary">No templates match the current filters.</p>
      )}

      {visibleTemplates?.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <div key={t.id} className="rounded-card bg-bg-card p-3 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={() => setPortfoliosOpenId(portfoliosOpenId === t.id ? null : t.id)}
                  aria-expanded={portfoliosOpenId === t.id}
                  aria-label="Show portfolios created from this template"
                  title="Show portfolios created from this template"
                  data-testid={`template-portfolios-toggle-${t.id}`}
                  className="mr-2 rounded-btn border border-border bg-bg-card px-2 py-0.5 text-lg font-semibold leading-none text-accent hover:bg-bg-primary"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={`transition-transform duration-150 ${portfoliosOpenId === t.id ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  data-testid={`template-row-${t.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {t.templateName}
                </button>
                <span className={`ml-2 rounded-btn px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? ''}`}>{t.status}</span>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Created by {t.createdByEmail ?? 'unknown'} · {formatDateTime24(t.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {t.status === 'Pending Approval' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSetStatus(t.id, 'Approved')}
                      disabled={setStatus.isPending}
                      className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetStatus(t.id, 'Rejected')}
                      disabled={setStatus.isPending}
                      className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
                {/* Hard delete - never for Approved templates (an in-use template's own record
                    stays intact; use Reject to stop it being offered instead). */}
                {t.status !== 'Approved' && confirmingDeleteId !== t.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(t.id)}
                    data-testid={`template-delete-${t.id}`}
                    className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
                  >
                    Delete
                  </button>
                )}
                {confirmingDeleteId === t.id && (
                  <>
                    <span className="text-sm text-text-primary">Delete permanently?</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleteTemplate.isPending}
                      data-testid={`template-delete-confirm-${t.id}`}
                      className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {deleteTemplate.isPending ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                    <button type="button" onClick={() => setConfirmingDeleteId(null)} className="text-sm text-text-secondary hover:underline">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
            {actionErrorFor === t.id && (
              <p className="mt-1 text-sm text-danger">
                {(setStatus.error instanceof ApiError && setStatus.error.message)
                  || (deleteTemplate.error instanceof ApiError && deleteTemplate.error.message)
                  || 'Could not update this template.'}
              </p>
            )}

            {portfoliosOpenId === t.id && (
              <div className="mt-3 border-t border-border pt-3">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Portfolios created from this template</h3>
                <TemplatePortfolioList templateId={t.id} />
              </div>
            )}

            {expanded && (
              <div className="mt-3 border-t border-border pt-3">
                {detailLoading && <p className="text-sm text-text-secondary">Loading detail…</p>}
                {detail && detail.id === t.id && (
                  <>
                    {detail.howToUseDescription && (
                      <>
                        <h3 className="mb-1 text-sm font-semibold text-text-primary">How to use</h3>
                        <p className="mb-3 whitespace-pre-wrap text-sm text-text-secondary">{detail.howToUseDescription}</p>
                      </>
                    )}
                    <p className="mb-3 text-xs text-text-muted">
                      Header row {detail.headerRowIndex}, data starts at column {detail.dataStartColumnIndex}.
                      {detail.footerMarkerColumnIndex !== null && detail.footerMarkerText !== null && (
                        <> Footer detected when column {detail.footerMarkerColumnIndex} contains "{detail.footerMarkerText}".</>
                      )}
                      {detail.cashConfig && (
                        <>
                          {' '}Cash row detected when column {detail.cashConfig.markerColumnIndex} contains "{detail.cashConfig.markerText}"
                          {detail.cashConfig.valueSource?.type === 'column' && <> (value from column {detail.cashConfig.valueSource.columnIndex})</>}
                          {detail.cashConfig.valueSource?.type === 'embedded' && <> (value embedded in the identifier cell)</>}
                          {!detail.cashConfig.valueSource && <> (value from quantity × current price)</>}.
                        </>
                      )}
                    </p>
                    <h3 className="mb-1 text-sm font-semibold text-text-primary">Column mapping</h3>
                    <ul className="mb-3 flex flex-col gap-0.5 text-sm text-text-secondary">
                      {Object.entries(detail.columnMapping).map(([field, header]) => (
                        <li key={field}>{TARGET_FIELD_LABELS[field] ?? field}: <span className="text-text-primary">{header}</span></li>
                      ))}
                    </ul>
                    {Array.isArray(detail.samplePreview) && detail.samplePreview.length > 0 && (
                      <>
                        <h3 className="mb-1 text-sm font-semibold text-text-primary">Sample preview</h3>
                        <div className="overflow-x-auto rounded-card border border-border">
                          <pre className="p-2 text-xs text-text-secondary">{JSON.stringify(detail.samplePreview, null, 2)}</pre>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

    <UnattachedFlexPortfoliosSection />

    {boundPortfoliosModalFor && (
      <BoundPortfoliosModal
        templateId={boundPortfoliosModalFor}
        deleteTemplate={deleteTemplate}
        onDeleteTemplate={() => handleDelete(boundPortfoliosModalFor)}
        onClose={() => setBoundPortfoliosModalFor(null)}
      />
    )}
    </>
  );
}
