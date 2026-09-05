import { useState } from 'react';
import { useSaveFlexTemplate, useDeletePortfolio } from '../api/portfolios';
import { ApiError } from '../api/client';
import ColumnMappingWizard, { type MappingReadyResult } from './ColumnMappingWizard';

interface FlexResolutionBannerProps {
  portfolioId: string;
  portfolioName: string;
  // The mapping/preview that created this portfolio, if still held in this browser session
  // (FlexPortfolioPage keeps it after a fresh "new mapping" creation). Null after a reload or
  // a later visit — the mapping was never persisted anywhere for a Flex-Err portfolio (that's
  // the whole point of Save Template), so the user has to re-derive it via the wizard again.
  sessionMapping: MappingReadyResult | null;
  onSaved: () => void;
  onDeleted: () => void;
}

// Portfolio Upload - Flex's forced-resolution rule (CLAUDE.md's "Portfolio Upload - Flex"
// section): a Flex-Err portfolio already has real, persisted data and a real Dashboard - the
// only two ways out are Save Template (proves the mapping genuinely produced a correct
// Dashboard) or Delete Portfolio (existing feature, reused as-is). No third "leave it
// unresolved" path - this banner stays up until one of the two happens.
export default function FlexResolutionBanner({ portfolioId, portfolioName, sessionMapping, onSaved, onDeleted }: FlexResolutionBannerProps) {
  const [remapping, setRemapping] = useState<MappingReadyResult | null>(sessionMapping);
  // Defaults to the portfolio's own name rather than starting blank - the portfolio name was
  // just typed one step earlier, and re-typing it for the template felt like being asked the
  // same thing twice. Still fully editable, e.g. to give the template a more generic reusable
  // name than this one specific portfolio's.
  const [templateName, setTemplateName] = useState(portfolioName);
  const [howToUseDescription, setHowToUseDescription] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const saveTemplate = useSaveFlexTemplate(portfolioId);
  const deletePortfolio = useDeletePortfolio();

  async function handleSave() {
    if (!remapping || !templateName.trim()) return;
    await saveTemplate.mutateAsync({
      templateName: templateName.trim(),
      columnMapping: remapping.columnMapping,
      samplePreview: remapping.preview.holdings.slice(0, 5),
      headerRowIndex: remapping.headerRowIndex,
      dataStartColumnIndex: remapping.dataStartColumnIndex,
      footerMarkerColumnIndex: remapping.footerMarkerColumnIndex,
      footerMarkerText: remapping.footerMarkerText,
      cashConfig: remapping.cashConfig,
      howToUseDescription: howToUseDescription.trim() || undefined,
    });
    onSaved();
  }

  async function handleDelete() {
    // Guards against the confirm button firing more than once for a single logical
    // delete (rapid double-click, or repeated activation before the first request
    // settles) — concurrent calls on the same mutation object can otherwise race,
    // leaving an earlier in-flight call's promise never observed as settled and the
    // button stuck on "Deleting…" even after the delete has actually succeeded.
    if (deletePortfolio.isPending) return;
    await deletePortfolio.mutateAsync(portfolioId);
    onDeleted();
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-warning bg-warning/10 p-4">
      <div>
        <p className="font-semibold text-warning">⚠ This portfolio needs attention</p>
        <p className="mt-1 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{portfolioName}</span> was created from a brand-new
          mapping. Review the Dashboard below — if it looks right, Save Template so future uploads can reuse it.
          If the mapping looks wrong, delete this portfolio and try again with a corrected file.
        </p>
      </div>

      {!remapping && (
        <div>
          <p className="mb-2 text-sm text-text-secondary">
            The original mapping isn't available in this session anymore — re-confirm it to Save Template.
          </p>
          <ColumnMappingWizard onReady={setRemapping} onCancel={() => {}} />
        </div>
      )}

      {remapping && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="flex-save-template-name" className="mb-1 block text-sm font-medium text-text-primary">
                Template name
              </label>
              <input
                id="flex-save-template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Schwab Export"
                data-testid="flex-save-template-name"
                className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!templateName.trim() || saveTemplate.isPending}
              data-testid="flex-save-template-submit"
              className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {saveTemplate.isPending ? 'Saving…' : 'Save Template'}
            </button>
          </div>
          <div>
            <label htmlFor="flex-save-template-description" className="mb-1 block text-sm font-medium text-text-primary">
              How to use this template <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <textarea
              id="flex-save-template-description"
              value={howToUseDescription}
              onChange={(e) => setHowToUseDescription(e.target.value)}
              placeholder="Notes for yourself or an admin — e.g. where the header row is in this file"
              rows={2}
              data-testid="flex-save-template-description"
              className="w-full max-w-md rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            />
          </div>
          {saveTemplate.isError && (
            <p className="w-full text-sm text-danger">
              {saveTemplate.error instanceof ApiError ? saveTemplate.error.message : 'Could not save the template.'}
            </p>
          )}
        </div>
      )}

      <div className="border-t border-warning/40 pt-3">
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-btn border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
          >
            Delete Portfolio
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-primary">Delete "{portfolioName}" and start over?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deletePortfolio.isPending}
              className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
            >
              {deletePortfolio.isPending ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="text-sm text-text-secondary hover:underline">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
