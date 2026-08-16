import { useEffect, useMemo, useRef, useState } from 'react';
import { useFlexPreview } from '../api/portfolios';
import type { ImportPreviewResult } from '../api/portfolios';
import { ALL_TARGET_FIELDS, MANDATORY_TARGET_FIELDS, TARGET_FIELD_LABELS } from '../api/portfolioTemplates';
import type { ColumnMapping } from '../api/portfolioTemplates';
import { ApiError } from '../api/client';
import { parseCsvGrid } from '../lib/csvHeaders';
import { xlsxFileToCsv } from '../lib/xlsxToCsv';

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.xlsm'];
const GRID_PREVIEW_ROWS = 50;

export interface MappingReadyResult {
  columnMapping: ColumnMapping;
  filename: string;
  content: string;
  preview: ImportPreviewResult;
  headerRowIndex: number;
  dataStartColumnIndex: number;
}

interface ColumnMappingWizardProps {
  onReady: (result: MappingReadyResult) => void;
  onCancel: () => void;
}

// Portfolio Upload - Flex "Create New Template" flow (CLAUDE.md's "Portfolio Upload - Flex"
// section): file -> confirm where the real header row/data columns start (real broker exports
// like Charles Schwab put preamble rows above the real header) -> detected headers (left) vs.
// the app's mandatory fields (right) -> user maps by assigning columns -> "Inspect Data"
// (disabled until every mandatory field is mapped) -> shows a top-5 preview. Calling code
// (FlexPortfolioPage / the Save Template resolution flow) decides what happens once a mapping
// is proven to parse cleanly - this component's only job is producing a mapping + preview it's
// confident in.
export default function ColumnMappingWizard({ onReady, onCancel }: ColumnMappingWizardProps) {
  const [file, setFile] = useState<{ filename: string; content: string; grid: string[][] } | null>(null);
  // 1-based throughout (row/column 1 = the file's first row/column) - matches what gets saved
  // on a template and what flexParser.service.ts's parseFlexCsv expects. The only place this
  // ever becomes a 0-based array index is right where the grid array is actually indexed,
  // below.
  const [headerRowIndex, setHeaderRowIndexState] = useState(1);
  const [dataStartColumnIndex, setDataStartColumnIndexState] = useState(1);
  // Separate from the committed numeric state so the input can show a genuinely empty field
  // while the user is mid-edit (e.g. selecting all and retyping) without snapping back to "1"
  // on every keystroke - only a value that actually parses gets committed via updateIndices.
  const [headerRowText, setHeaderRowText] = useState('1');
  const [dataStartColumnText, setDataStartColumnText] = useState('1');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const flexPreview = useFlexPreview();

  const headers = useMemo(
    () => (file?.grid[headerRowIndex - 1] ?? []).slice(dataStartColumnIndex - 1),
    [file, headerRowIndex, dataStartColumnIndex],
  );
  const maxCols = useMemo(() => Math.max(1, ...(file?.grid.map((row) => row.length) ?? [1])), [file]);

  // A previously-picked header string may no longer exist at all once the derived `headers`
  // array changes (it may have moved to a different column, or disappeared if the new
  // selection isn't actually a header row) - so any change to either index clears the
  // in-progress mapping, same as an individual mapping edit already clears `preview`.
  function updateIndices(nextHeaderRowIndex: number, nextDataStartColumnIndex: number) {
    setHeaderRowIndexState(nextHeaderRowIndex);
    setDataStartColumnIndexState(nextDataStartColumnIndex);
    setHeaderRowText(String(nextHeaderRowIndex));
    setDataStartColumnText(String(nextDataStartColumnIndex));
    setMapping({});
    setPreview(null);
  }

  function handleHeaderRowTextChange(raw: string) {
    setHeaderRowText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) return; // mid-edit (e.g. just cleared) - wait for a real number
    updateIndices(Math.min(Math.max(1, parsed), file?.grid.length ?? 1), dataStartColumnIndex);
  }

  function handleDataStartColumnTextChange(raw: string) {
    setDataStartColumnText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    updateIndices(headerRowIndex, Math.min(Math.max(1, parsed), maxCols));
  }

  useEffect(() => {
    const key = `${headerRowIndex - 1}-${dataStartColumnIndex - 1}`;
    cellRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [headerRowIndex, dataStartColumnIndex]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setReadError(null);
    setPreview(null);
    setMapping({});
    setHeaderRowIndexState(1);
    setDataStartColumnIndexState(1);
    setHeaderRowText('1');
    setDataStartColumnText('1');

    try {
      const isExcel = EXCEL_EXTENSIONS.some((ext) => picked.name.toLowerCase().endsWith(ext));
      const content = isExcel ? await xlsxFileToCsv(picked) : await picked.text();
      const grid = parseCsvGrid(content, GRID_PREVIEW_ROWS);
      if (!grid.length || !grid[0]?.length) {
        setReadError('No header row could be detected in this file.');
        return;
      }
      setFile({ filename: picked.name, content, grid });
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function setFieldMapping(field: string, header: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (header) next[field] = header; else delete next[field];
      return next;
    });
    setPreview(null);
  }

  const mandatoryMapped = MANDATORY_TARGET_FIELDS.every((f) => !!mapping[f]);

  async function handleInspect() {
    if (!file || !mandatoryMapped) return;
    const result = await flexPreview.mutateAsync({
      columnMapping: mapping,
      filename: file.filename,
      content: file.content,
      headerRowIndex,
      dataStartColumnIndex,
    });
    setPreview(result);
  }

  function handleUseMapping() {
    if (!file || !preview) return;
    onReady({ columnMapping: mapping, filename: file.filename, content: file.content, preview, headerRowIndex, dataStartColumnIndex });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="flex-mapping-file" className="mb-1 block text-sm font-medium text-text-primary">
          1. Choose a file
        </label>
        <input
          id="flex-mapping-file"
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.xls,.xlsx,.xlsm"
          onChange={handleFileChange}
          data-testid="flex-mapping-file-input"
          className="block text-sm text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-white file:hover:bg-accent-hover"
        />
        {readError && <p className="mt-2 text-sm text-danger">{readError}</p>}
      </div>

      {file && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-primary">2. Confirm header row &amp; data start column</h3>
          <p className="mb-2 text-xs text-text-muted">
            Click the cell where your real header row and real data columns start (some files have summary rows
            above the headers) — or type the row/column numbers directly.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-sm text-text-primary">
              Header row
              <input
                type="number"
                min={1}
                max={file.grid.length}
                value={headerRowText}
                onChange={(e) => handleHeaderRowTextChange(e.target.value)}
                onBlur={() => setHeaderRowText(String(headerRowIndex))}
                data-testid="flex-header-row-input"
                className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
              />
            </label>
            <label className="flex items-center gap-1 text-sm text-text-primary">
              Data start column
              <input
                type="number"
                min={1}
                max={maxCols}
                value={dataStartColumnText}
                onChange={(e) => handleDataStartColumnTextChange(e.target.value)}
                onBlur={() => setDataStartColumnText(String(dataStartColumnIndex))}
                data-testid="flex-data-start-column-input"
                className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-auto rounded-card border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <tbody>
                {file.grid.map((row, r) => {
                  const isHeaderRow = r === headerRowIndex - 1;
                  return (
                    <tr key={r} className={isHeaderRow ? 'bg-accent/10' : ''}>
                      {Array.from({ length: maxCols }, (_, c) => {
                        const isSkippedRow = r < headerRowIndex - 1;
                        const isSkippedCol = c < dataStartColumnIndex - 1;
                        const isActive = isHeaderRow && c === dataStartColumnIndex - 1;
                        return (
                          <td key={c} className="border border-border p-0">
                            <button
                              type="button"
                              ref={(el) => {
                                if (el) cellRefs.current.set(`${r}-${c}`, el);
                                else cellRefs.current.delete(`${r}-${c}`);
                              }}
                              onClick={() => updateIndices(r + 1, c + 1)}
                              data-testid={`grid-cell-${r}-${c}`}
                              className={`block w-full whitespace-nowrap px-2 py-1 text-left hover:bg-accent/20 ${
                                isActive ? 'bg-accent/30 font-semibold text-text-primary' : ''
                              } ${isSkippedRow || isSkippedCol ? 'text-text-muted' : 'text-text-primary'}`}
                            >
                              {row[c] ?? ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {file && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-primary">3. Map columns</h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {ALL_TARGET_FIELDS.map((field) => {
              const isMandatory = (MANDATORY_TARGET_FIELDS as readonly string[]).includes(field);
              return (
                <div key={field} className="flex items-center justify-between gap-3 rounded-btn border border-border px-3 py-2">
                  <span className="text-sm text-text-primary">
                    {TARGET_FIELD_LABELS[field] ?? field}
                    {isMandatory && <span className="ml-1 text-danger" aria-label="mandatory">*</span>}
                  </span>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) => setFieldMapping(field, e.target.value)}
                    data-testid={`flex-map-${field}`}
                    className="rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-muted">* Mandatory field — required before Inspect Data is available.</p>
        </div>
      )}

      {file && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleInspect}
            disabled={!mandatoryMapped || flexPreview.isPending}
            data-testid="flex-inspect-data"
            className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {flexPreview.isPending ? 'Inspecting…' : 'Inspect Data'}
          </button>
          <button type="button" onClick={onCancel} className="text-sm text-text-secondary hover:underline">
            Cancel
          </button>
        </div>
      )}

      {flexPreview.isError && (
        <p className="text-sm text-danger">
          {flexPreview.error instanceof ApiError ? flexPreview.error.message : 'Could not parse the file against this mapping.'}
        </p>
      )}

      {preview && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-primary">4. Preview (first 5 records)</h3>
          {preview.errors.length > 0 && (
            <div className="mb-2 rounded-card border border-warning bg-warning/10 p-3">
              <p className="text-sm font-medium text-warning">{preview.errors.length} row(s) had issues</p>
              <ul className="list-inside list-disc text-xs text-text-secondary">
                {preview.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded-card border border-border" data-testid="flex-preview-table">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-secondary text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Current Price</th>
                  <th className="px-3 py-2">Purchase Price</th>
                  <th className="px-3 py-2">Sector</th>
                </tr>
              </thead>
              <tbody>
                {preview.holdings.slice(0, 5).map((h, i) => (
                  <tr key={`${h.symbol}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-text-primary">{h.symbol}</td>
                    <td className="px-3 py-2 text-text-secondary">{h.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{h.quantity}</td>
                    <td className="px-3 py-2 text-text-secondary">{h.currentPrice}</td>
                    <td className="px-3 py-2 text-text-secondary">{h.purchasePrice}</td>
                    <td className="px-3 py-2 text-text-secondary">{h.sector}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleUseMapping}
              data-testid="flex-use-mapping"
              className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Use This Mapping →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
