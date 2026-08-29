import { useState } from 'react';
import {
  useAllTemplates, useTemplateDetail, useSetTemplateStatus, useDeleteTemplate,
  useBoundPortfolios, useDeleteBoundPortfolio,
  useUnattachedFlexPortfolios, useDeleteUnattachedFlexPortfolio, TARGET_FIELD_LABELS,
} from '../api/portfolioTemplates';
import { ApiError } from '../api/client';
import { formatCurrency } from '../lib/format';

const STATUS_STYLES: Record<string, string> = {
  'Pending Approval': 'bg-warning/10 text-warning',
  Approved: 'bg-success/10 text-success',
  Rejected: 'bg-danger/10 text-danger',
};

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
  const [confirmingPortfolioId, setConfirmingPortfolioId] = useState<string | null>(null);

  async function handleDeletePortfolio(id: string) {
    try {
      await deleteBoundPortfolio.mutateAsync(id);
      setConfirmingPortfolioId(null);
    } catch {
      // surfaced below via deleteBoundPortfolio.isError
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
          This template can't be deleted while it's still bound to a portfolio. Delete the portfolio(s) below to free it up.
        </p>

        {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

        {portfolios && portfolios.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2 overflow-y-auto" data-testid="bound-portfolios-list">
            {portfolios.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-text-primary">{p.name}</p>
                  <p className="text-xs text-text-muted">{p.ownerEmail}</p>
                </div>
                {confirmingPortfolioId !== p.id ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingPortfolioId(p.id)}
                    data-testid={`bound-portfolio-delete-${p.id}`}
                    className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeletePortfolio(p.id)}
                      disabled={deleteBoundPortfolio.isPending}
                      data-testid={`bound-portfolio-delete-confirm-${p.id}`}
                      className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {deleteBoundPortfolio.isPending ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                    <button type="button" onClick={() => setConfirmingPortfolioId(null)} className="text-sm text-text-secondary hover:underline">
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {deleteBoundPortfolio.isError && (
          <p className="mb-4 text-sm text-danger">
            {deleteBoundPortfolio.error instanceof ApiError ? deleteBoundPortfolio.error.message : 'Could not delete this portfolio.'}
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
  const { data: detail, isLoading: detailLoading } = useTemplateDetail(expandedId);
  const setStatus = useSetTemplateStatus();
  const deleteTemplate = useDeleteTemplate();
  const [actionErrorFor, setActionErrorFor] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Set when a Delete attempt 409s because the template is still bound to a portfolio -
  // opens the BoundPortfoliosModal instead of just leaving a plain error message, since that's
  // an actionable next step, not a dead end.
  const [boundPortfoliosModalFor, setBoundPortfoliosModalFor] = useState<string | null>(null);

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
      if (err instanceof ApiError && err.status === 409) {
        setBoundPortfoliosModalFor(id);
      } else {
        setActionErrorFor(id);
      }
    }
  }

  return (
    <>
    <div className="flex flex-col gap-2">
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {!isLoading && templates?.length === 0 && <p className="text-sm text-text-secondary">No portfolio templates have been created yet.</p>}

      {templates?.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <div key={t.id} className="rounded-card bg-bg-card p-3 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  data-testid={`template-row-${t.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {t.templateName}
                </button>
                <span className={`ml-2 rounded-btn px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? ''}`}>{t.status}</span>
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
