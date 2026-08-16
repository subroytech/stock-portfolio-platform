import { useState } from 'react';
import { useAllTemplates, useTemplateDetail, useSetTemplateStatus, TARGET_FIELD_LABELS } from '../api/portfolioTemplates';
import { ApiError } from '../api/client';

const STATUS_STYLES: Record<string, string> = {
  'Pending Approval': 'bg-warning/10 text-warning',
  Approved: 'bg-success/10 text-success',
  Rejected: 'bg-danger/10 text-danger',
};

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
  const [actionErrorFor, setActionErrorFor] = useState<string | null>(null);

  async function handleSetStatus(id: string, status: 'Approved' | 'Rejected') {
    setActionErrorFor(null);
    try {
      await setStatus.mutateAsync({ id, status });
    } catch {
      setActionErrorFor(id);
    }
  }

  return (
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
              {t.status === 'Pending Approval' && (
                <div className="flex items-center gap-2">
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
                </div>
              )}
            </div>
            {actionErrorFor === t.id && (
              <p className="mt-1 text-sm text-danger">
                {setStatus.error instanceof ApiError ? setStatus.error.message : 'Could not update this template\'s status.'}
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
  );
}
