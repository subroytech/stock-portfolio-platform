import { useRef, useState, type FormEvent } from 'react';
import { usePortfolios, usePortfolio, useCreatePortfolioFlex, useChangeFlexTemplate, useRefreshPrices } from '../api/portfolios';
import type { RefreshPricesResult } from '../api/portfolios';
import type { TemplateSummary } from '../api/portfolioTemplates';
import { ApiError } from '../api/client';
import { formatAsOf } from '../lib/format';
import { xlsxFileToCsv } from '../lib/xlsxToCsv';
import FlexTemplatePicker from '../components/FlexTemplatePicker';
import ColumnMappingWizard, { type MappingReadyResult } from '../components/ColumnMappingWizard';
import FlexResolutionBanner from '../components/FlexResolutionBanner';
import KpiCards from '../components/KpiCards';
import AllocationChart, { AllocationModeToggle } from '../components/AllocationChart';
import type { AllocationMode } from '../components/AllocationChart';
import PerformanceChart from '../components/PerformanceChart';
import HoldingsTable from '../components/HoldingsTable';
import StockPreviewChart from '../components/StockPreviewChart';

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.xlsm'];

type CreateStep = 'closed' | 'picker' | 'wizard' | 'finalize';

// Portfolio Upload - Flex (CLAUDE.md's "Portfolio Upload - Flex" section) - the Flex sub-tab
// (TabShell.tsx, Phase 4). A portfolio's flexTemplateStatus is what tells Legacy and Flex
// portfolios apart within the same tx_portfolios table - this page only ever shows the ones
// created through this flow (flexTemplateStatus !== null).
export default function FlexPortfolioPage() {
  const { data: allPortfolios, isLoading: portfoliosLoading } = usePortfolios();
  const flexPortfolios = allPortfolios?.filter((p) => p.flexTemplateStatus !== null) ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSymbol, setPreviewSymbol] = useState<string | null>(null);
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('todayDollar');

  const [createStep, setCreateStep] = useState<CreateStep>('closed');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSummary | null>(null);
  const [wizardResult, setWizardResult] = useState<MappingReadyResult | null>(null);
  const [name, setName] = useState('');
  const [existingFile, setExistingFile] = useState<{ filename: string; content: string } | null>(null);
  const [existingFileError, setExistingFileError] = useState<string | null>(null);
  const existingFileInputRef = useRef<HTMLInputElement>(null);
  const createFlex = useCreatePortfolioFlex();

  // Keyed by portfolio id, not a single slot — mirrors DashboardPage's resultsByPortfolio
  // pattern. Holds the mapping/preview that just created a Flex-Err portfolio so
  // FlexResolutionBanner can offer a same-session Save Template without re-uploading.
  const [sessionMappingByPortfolio, setSessionMappingByPortfolio] = useState<Record<string, MappingReadyResult>>({});

  const { data: portfolio, isLoading } = usePortfolio(selectedId);
  const refreshPrices = useRefreshPrices(selectedId ?? '');
  const changeTemplate = useChangeFlexTemplate(selectedId ?? '');
  const [resultsByPortfolio, setResultsByPortfolio] = useState<Record<string, RefreshPricesResult>>({});
  const refreshResult = selectedId ? resultsByPortfolio[selectedId] : undefined;
  const [reuploadFile, setReuploadFile] = useState<{ filename: string; content: string } | null>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const [changingTemplate, setChangingTemplate] = useState(false);

  function resetCreateFlow() {
    setCreateStep('closed');
    setSelectedTemplate(null);
    setWizardResult(null);
    setName('');
    setExistingFile(null);
    setExistingFileError(null);
  }

  async function handleExistingFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExistingFileError(null);
    try {
      const isExcel = EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      const content = isExcel ? await xlsxFileToCsv(file) : await file.text();
      setExistingFile({ filename: file.name, content });
    } catch (err) {
      setExistingFileError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      if (existingFileInputRef.current) existingFileInputRef.current.value = '';
    }
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const result = selectedTemplate
      ? existingFile && await createFlex.mutateAsync({ name: name.trim(), uploadTemplateId: selectedTemplate.id, filename: existingFile.filename, content: existingFile.content })
      : wizardResult && await createFlex.mutateAsync({
          name: name.trim(),
          columnMapping: wizardResult.columnMapping,
          filename: wizardResult.filename,
          content: wizardResult.content,
          headerRowIndex: wizardResult.headerRowIndex,
          dataStartColumnIndex: wizardResult.dataStartColumnIndex,
          footerMarkerColumnIndex: wizardResult.footerMarkerColumnIndex ?? undefined,
          footerMarkerText: wizardResult.footerMarkerText ?? undefined,
          cashConfig: wizardResult.cashConfig ?? undefined,
        });

    if (!result) return;
    if (wizardResult) {
      setSessionMappingByPortfolio((prev) => ({ ...prev, [result.portfolio.id]: wizardResult }));
    }
    setSelectedId(result.portfolio.id);
    resetCreateFlow();
  }

  async function handleReupload() {
    if (!selectedId || !portfolio || !reuploadFile || !portfolio.uploadTemplateId) return;
    await changeTemplate.mutateAsync({ uploadTemplateId: portfolio.uploadTemplateId, filename: reuploadFile.filename, content: reuploadFile.content });
    setReuploadFile(null);
  }

  async function handleReuploadFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    const content = isExcel ? await xlsxFileToCsv(file) : await file.text();
    setReuploadFile({ filename: file.name, content });
    if (reuploadInputRef.current) reuploadInputRef.current.value = '';
  }

  // "Change Template" — rebinds this portfolio to a brand-new mapping (as opposed to
  // handleReupload, which always reuses the current template). Requires re-running the
  // grid/mapping wizard and a successful Inspect Data pass before rebinding, same "prove
  // it against real parsing first" rule as creating a new mapping from scratch.
  async function handleChangeTemplateReady(result: MappingReadyResult) {
    if (!selectedId) return;
    await changeTemplate.mutateAsync({
      columnMapping: result.columnMapping,
      headerRowIndex: result.headerRowIndex,
      dataStartColumnIndex: result.dataStartColumnIndex,
      footerMarkerColumnIndex: result.footerMarkerColumnIndex ?? undefined,
      footerMarkerText: result.footerMarkerText ?? undefined,
      cashConfig: result.cashConfig ?? undefined,
      filename: result.filename,
      content: result.content,
    });
    setChangingTemplate(false);
  }

  const handleRefresh = () => {
    if (!selectedId) return;
    const portfolioId = selectedId;
    refreshPrices.mutate(undefined, {
      onSuccess: (result) => setResultsByPortfolio((prev) => ({ ...prev, [portfolioId]: result })),
    });
  };

  const oldestPriceUpdate = portfolio
    ? portfolio.holdings.map((h) => h.priceUpdatedAt).filter((t): t is string => t != null).sort()[0] ?? null
    : null;

  return (
    <>
      <main className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {portfoliosLoading && <p className="text-sm text-text-secondary">Loading portfolios…</p>}
          {flexPortfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              data-testid={`flex-portfolio-pill-${p.id}`}
              className={`flex items-center gap-1 rounded-btn px-3 py-1.5 text-sm transition-colors ${
                p.id === selectedId ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'
              }`}
            >
              {p.name}
              {p.flexTemplateStatus === 'Flex-Err' && <span title="Needs attention" className="text-warning">⚠</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setSelectedId(null); setCreateStep('picker'); }}
            data-testid="flex-new-portfolio-button"
            className="rounded-btn border border-dashed border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
          >
            + New Flex Portfolio
          </button>
        </div>

        {createStep !== 'closed' && (
          <div className="rounded-card bg-bg-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Create New Portfolio — Flex</h2>
              <button type="button" onClick={resetCreateFlow} className="text-sm text-text-secondary hover:underline">
                Cancel
              </button>
            </div>

            {createStep === 'picker' && (
              <FlexTemplatePicker
                onSelectExisting={(t) => { setSelectedTemplate(t); setCreateStep('finalize'); }}
                onCreateNew={() => setCreateStep('wizard')}
              />
            )}

            {createStep === 'wizard' && (
              <ColumnMappingWizard
                onReady={(result) => { setWizardResult(result); setCreateStep('finalize'); }}
                onCancel={() => setCreateStep('picker')}
              />
            )}

            {createStep === 'finalize' && (
              <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
                <p className="text-sm text-text-secondary">
                  {selectedTemplate ? <>Using template <span className="font-medium text-text-primary">{selectedTemplate.templateName}</span></> : 'Using a new mapping — reviewed above.'}
                </p>
                <div>
                  <label htmlFor="flex-portfolio-name" className="mb-1 block text-sm font-medium text-text-primary">Portfolio name</label>
                  <input
                    id="flex-portfolio-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="flex-portfolio-name-input"
                    className="rounded-btn border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
                  />
                </div>

                {selectedTemplate && (
                  <div>
                    <label htmlFor="flex-existing-file" className="mb-1 block text-sm font-medium text-text-primary">File to import</label>
                    <input
                      id="flex-existing-file"
                      ref={existingFileInputRef}
                      type="file"
                      accept=".csv,.txt,.xls,.xlsx,.xlsm"
                      onChange={handleExistingFileChange}
                      data-testid="flex-existing-template-file-input"
                      className="block text-sm text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-white file:hover:bg-accent-hover"
                    />
                    {existingFileError && <p className="mt-1 text-sm text-danger">{existingFileError}</p>}
                  </div>
                )}

                <div>
                  <button
                    type="submit"
                    disabled={createFlex.isPending || !name.trim() || (!!selectedTemplate && !existingFile)}
                    data-testid="flex-create-portfolio-submit"
                    className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                  >
                    {createFlex.isPending ? 'Creating…' : 'Create Portfolio'}
                  </button>
                  {createFlex.isError && (
                    <p className="mt-2 text-sm text-danger">
                      {createFlex.error instanceof ApiError ? createFlex.error.message : 'Could not create the portfolio.'}
                    </p>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {!selectedId && createStep === 'closed' && (
          <p className="text-sm text-text-secondary">Select a Flex portfolio, or create a new one to get started.</p>
        )}

        {selectedId && isLoading && <p className="text-sm text-text-secondary">Loading portfolio…</p>}

        {selectedId && portfolio && (
          <>
            {portfolio.flexTemplateStatus === 'Flex-Err' && (
              <FlexResolutionBanner
                portfolioId={selectedId}
                portfolioName={portfolio.name}
                sessionMapping={sessionMappingByPortfolio[selectedId] ?? null}
                onSaved={() => setSessionMappingByPortfolio((prev) => { const next = { ...prev }; delete next[selectedId]; return next; })}
                onDeleted={() => { setSelectedId(null); setSessionMappingByPortfolio((prev) => { const next = { ...prev }; delete next[selectedId]; return next; }); }}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={reuploadInputRef}
                  type="file"
                  accept=".csv,.txt,.xls,.xlsx,.xlsm"
                  onChange={handleReuploadFileChange}
                  data-testid="flex-reupload-file-input"
                  className="block text-sm text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-white file:hover:bg-accent-hover"
                />
                {reuploadFile && portfolio.uploadTemplateId && (
                  <button
                    type="button"
                    onClick={handleReupload}
                    disabled={changeTemplate.isPending}
                    data-testid="flex-reupload-submit"
                    className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {changeTemplate.isPending ? 'Uploading…' : `Upload "${reuploadFile.filename}" (current template)`}
                  </button>
                )}
                {portfolio.flexTemplateStatus === 'Flex' && !changingTemplate && (
                  <button
                    type="button"
                    onClick={() => setChangingTemplate(true)}
                    data-testid="flex-change-template-button"
                    className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
                  >
                    Change Template
                  </button>
                )}
                {changeTemplate.isError && (
                  <p className="text-sm text-danger">
                    {changeTemplate.error instanceof ApiError ? changeTemplate.error.message : 'Upload failed.'}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshPrices.isPending}
                  className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                  {refreshPrices.isPending ? 'Refreshing…' : 'Refresh Prices'}
                </button>
                {oldestPriceUpdate && (
                  <p className="text-xs text-text-muted">Prices as of {formatAsOf(oldestPriceUpdate)}</p>
                )}
              </div>
            </div>

            {changingTemplate && (
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text-primary">Change Template — new mapping</h2>
                  <button type="button" onClick={() => setChangingTemplate(false)} className="text-sm text-text-secondary hover:underline">
                    Cancel
                  </button>
                </div>
                <p className="mb-3 text-sm text-text-secondary">
                  Upload a file and map its columns — this replaces the mapping this portfolio uses, after Inspect Data confirms it parses correctly.
                </p>
                <ColumnMappingWizard onReady={handleChangeTemplateReady} onCancel={() => setChangingTemplate(false)} />
                {changeTemplate.isError && (
                  <p className="mt-2 text-sm text-danger">
                    {changeTemplate.error instanceof ApiError ? changeTemplate.error.message : 'Could not change the template.'}
                  </p>
                )}
              </div>
            )}

            <KpiCards portfolio={portfolio} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-card bg-bg-card p-4 shadow-card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">Allocation</h2>
                  <AllocationModeToggle mode={allocationMode} onChange={setAllocationMode} />
                </div>
                <div className="h-96">
                  <AllocationChart holdings={portfolio.holdings} mode={allocationMode} />
                </div>
              </div>
              <div className="flex flex-col rounded-card bg-bg-card p-4 shadow-card">
                <h2 className="mb-3 shrink-0 text-sm font-semibold text-text-primary">Performance</h2>
                <div className="min-h-0 flex-1">
                  <PerformanceChart holdings={portfolio.holdings} refreshResult={refreshResult} />
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-text-primary">Holdings</h2>
              <HoldingsTable holdings={portfolio.holdings} onSymbolClick={setPreviewSymbol} />
            </div>
          </>
        )}
      </main>

      {previewSymbol && <StockPreviewChart symbol={previewSymbol} onClose={() => setPreviewSymbol(null)} />}
    </>
  );
}
