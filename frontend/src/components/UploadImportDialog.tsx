import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImportHoldings, usePreviewImport } from '../api/portfolios';
import { ApiError } from '../api/client';
import { xlsxFileToCsv } from '../lib/xlsxToCsv';

interface UploadImportDialogProps {
  portfolioId: string;
  hasExistingHoldings: boolean;
}

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.xlsm'];

// POST /portfolios/:id/import unconditionally REPLACES every existing
// holding — the backend enforces no confirmation of its own (a deliberate
// choice, see Architecture.md's Phase 3 plan / the portfolio-CRUD plan).
// This is that confirmation, as a UI responsibility.
export default function UploadImportDialog({ portfolioId, hasExistingHoldings }: UploadImportDialogProps) {
  const [pendingFile, setPendingFile] = useState<{ filename: string; content: string } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importHoldings = useImportHoldings(portfolioId);
  const previewImport = usePreviewImport(portfolioId);
  const navigate = useNavigate();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReadError(null);

    let content: string;
    try {
      const isExcel = EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      content = isExcel ? await xlsxFileToCsv(file) : await file.text();
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read the file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (hasExistingHoldings) {
      setPendingFile({ filename: file.name, content });
    } else {
      importHoldings.mutate({ filename: file.name, content });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function confirmReplace() {
    if (!pendingFile) return;
    importHoldings.mutate(pendingFile);
    setPendingFile(null);
  }

  async function proceedWithoutReplace() {
    if (!pendingFile) return;
    const preview = await previewImport.mutateAsync(pendingFile);
    navigate(`/portfolios/${portfolioId}/import-preview`, {
      state: { filename: pendingFile.filename, content: pendingFile.content, preview },
    });
    setPendingFile(null);
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.xls,.xlsx,.xlsm"
        onChange={handleFileChange}
        data-testid="import-file-input"
        className="block text-sm text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-white file:hover:bg-accent-hover"
      />

      {readError && <p className="mt-2 text-sm text-danger">{readError}</p>}
      {importHoldings.isPending && <p className="mt-2 text-sm text-text-secondary">Importing…</p>}
      {importHoldings.isError && (
        <p className="mt-2 text-sm text-danger">
          {importHoldings.error instanceof ApiError ? importHoldings.error.message : 'Import failed.'}
        </p>
      )}
      {importHoldings.isSuccess && (
        <p className="mt-2 text-sm text-success" data-testid="import-success">
          Imported {importHoldings.data.holdingsCount} holdings, logged {importHoldings.data.actionsLogged} buy/sell actions.
        </p>
      )}

      {pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card bg-bg-card p-6 shadow-card-lg">
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Replace existing holdings?</h2>
            <p className="mb-4 text-sm text-text-secondary">
              Importing <span className="font-medium text-text-primary">{pendingFile.filename}</span> will replace
              every holding currently in this portfolio. This can't be undone.
            </p>
            {previewImport.isError && (
              <p className="mb-3 text-sm text-danger">
                {previewImport.error instanceof ApiError ? previewImport.error.message : 'Could not parse the file.'}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingFile(null)}
                className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={proceedWithoutReplace}
                disabled={previewImport.isPending}
                className="rounded-btn border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-primary disabled:opacity-60"
              >
                {previewImport.isPending ? 'Parsing…' : 'Proceed w/o Replace'}
              </button>
              <button
                type="button"
                onClick={confirmReplace}
                className="rounded-btn bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90"
              >
                Replace holdings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
