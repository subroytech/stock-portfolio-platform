import { useEffect, useMemo, useRef, useState } from 'react';
import { useFlexPreview } from '../api/portfolios';
import type { ImportPreviewResult } from '../api/portfolios';
import { ALL_TARGET_FIELDS, MANDATORY_TARGET_FIELDS, TARGET_FIELD_LABELS } from '../api/portfolioTemplates';
import type { ColumnMapping, CashConfig } from '../api/portfolioTemplates';
import { ApiError } from '../api/client';
import { parseCsvGrid } from '../lib/csvHeaders';
import { xlsxFileToCsv } from '../lib/xlsxToCsv';
import { formatCurrency } from '../lib/format';

const EXCEL_EXTENSIONS = ['.xls', '.xlsx', '.xlsm'];
// 1 header + up to 200 data rows + 1 footer row - a hard cap on the SAMPLE file used to define
// a brand-new template (also enforced backend-side, see flexParser.service.ts's
// MAX_TEMPLATE_SAMPLE_LINES/assertWithinTemplateSampleLimit - never trust client-only
// validation). Never limits reusing an already-saved template (no grid shown there at all -
// the reuse path skips this component entirely). Sized so the grid can always show the whole
// sample file, keeping the footer marker row clickable regardless of where it falls - this
// app's retail-investor portfolios rarely exceed ~100 holdings, so 200 leaves real headroom.
const GRID_PREVIEW_ROWS = 202;

export interface MappingReadyResult {
  columnMapping: ColumnMapping;
  filename: string;
  content: string;
  preview: ImportPreviewResult;
  headerRowIndex: number;
  dataStartColumnIndex: number;
  footerMarkerColumnIndex: number | null;
  footerMarkerText: string | null;
  cashConfig: CashConfig | null;
}

interface ColumnMappingWizardProps {
  onReady: (result: MappingReadyResult) => void;
  onCancel: () => void;
}

// Guided sequence (CLAUDE.md's "Portfolio Upload - Flex" / "Flex CSV Parsing" sections) -
// Header (mandatory) -> Footer (optional, Skip or Next) -> Cash (optional, Skip or Next) ->
// Map Columns. Each stage's own controls are the only ones shown/clickable at a time - going
// back never clears data already entered, it's purely a visibility pointer.
type WizardStep = 'header' | 'footer' | 'cash' | 'mapping';
type CashValueMode = 'auto' | 'column' | 'embedded';

// Single-line progress indicator for the stepper bar - replaces the old dynamic per-stage
// heading ("2. Footer marker (optional)" etc.), which took its own line to convey only the
// current stage; this shows every stage at a glance (done/current/upcoming) in the same
// vertical space. Covers the WHOLE wizard flow, not just header/footer/cash setup - the last
// two aren't real wizardStep values (both happen while wizardStep === 'mapping'), their status
// is derived from mandatoryMapped/preview instead - see stepStatus().
type DisplayStepKey = WizardStep | 'inspectData' | 'confirmMapping';
const DISPLAY_STEPS: { key: DisplayStepKey; label: string }[] = [
  { key: 'header', label: 'Header' },
  { key: 'footer', label: 'Footer' },
  { key: 'cash', label: 'Cash' },
  { key: 'mapping', label: 'Map Columns' },
  { key: 'inspectData', label: 'Inspect Data' },
  { key: 'confirmMapping', label: 'Confirm Mapping' },
];

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
  // Whether the user has actually confirmed a header row (by clicking a cell or committing a
  // number in either input) - headerRowIndex itself defaults to 1 for a reason unrelated to
  // "the user picked row 1": before any real interaction, that default must not be visually
  // highlighted as if it were a deliberate choice (reported live: it looked like row 1 was
  // being treated specially the moment a file loaded, before anyone had chosen anything).
  const [headerConfirmed, setHeaderConfirmed] = useState(false);
  // Separate from the committed numeric state so the input can show a genuinely empty field
  // while the user is mid-edit (e.g. selecting all and retyping) without snapping back to "1"
  // on every keystroke - only a value that actually parses gets committed via updateIndices.
  const [headerRowText, setHeaderRowText] = useState('1');
  const [dataStartColumnText, setDataStartColumnText] = useState('1');

  const [wizardStep, setWizardStep] = useState<WizardStep>('header');

  const [footerMarkerColumnIndex, setFooterMarkerColumnIndex] = useState<number | null>(null);
  const [footerMarkerText, setFooterMarkerText] = useState('');
  // Draft text for the footer marker column input, same empty-while-mid-edit pattern as
  // headerRowText/dataStartColumnText above - lets typing (not just clicking a grid cell) set
  // the column, which clicking alone didn't support.
  const [footerMarkerColumnText, setFooterMarkerColumnText] = useState('');

  // Cash/cash-equivalent row marker - same (column, text) shape as the footer marker, but can
  // match multiple rows (not a single boundary).
  const [cashMarkerColumnIndex, setCashMarkerColumnIndex] = useState<number | null>(null);
  const [cashMarkerText, setCashMarkerText] = useState('');
  const [cashMarkerColumnText, setCashMarkerColumnText] = useState('');
  // Which of the cash stage's two possible click targets a grid click currently sets - only
  // relevant once cashValueMode === 'column' (the only sub-case with two coexisting clickable
  // targets); a plain 'auto'/'embedded' cash stage always treats a click as setting the marker.
  const [cashPickTarget, setCashPickTarget] = useState<'marker' | 'value'>('marker');
  // 'auto' = the implicit fallback (quantity x currentPrice, unchanged default). 'column' =
  // Pattern #1, the value lives in a separate column. 'embedded' = Pattern #2, the value is
  // fused into the marker cell itself (e.g. "Cash, Money Funds and Bank Deposits: $2,143.67") -
  // nothing further to configure in that case.
  const [cashValueMode, setCashValueMode] = useState<CashValueMode>('auto');
  const [cashValueColumnIndex, setCashValueColumnIndex] = useState<number | null>(null);
  const [cashValueColumnText, setCashValueColumnText] = useState('');

  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  // "Use This Mapping" stays disabled until the user has actually scrolled the preview table
  // into view (a real requirement, not just a suggestion - see the IntersectionObserver effect
  // below) - resets on every fresh Inspect Data run, not just once ever.
  const [hasSeenPreview, setHasSeenPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const previewEndRef = useRef<HTMLDivElement>(null);
  const flexPreview = useFlexPreview();

  const headers = useMemo(
    () => (file?.grid[headerRowIndex - 1] ?? []).slice(dataStartColumnIndex - 1),
    [file, headerRowIndex, dataStartColumnIndex],
  );
  const maxCols = useMemo(() => Math.max(1, ...(file?.grid.map((row) => row.length) ?? [1])), [file]);

  // Live preview of which row (if any) the current footer marker actually matches in this
  // sample file - same "contains" match, same column coordinate space, as
  // flexParser.service.ts's real backend detection. Lets the grid scroll to and highlight that
  // row as soon as a column + text are set (by click or by typing), so a typo or wrong column
  // is visible immediately instead of only surfacing later via Inspect Data.
  const footerMatchRowIdx = useMemo(() => {
    if (!file || footerMarkerColumnIndex == null || !footerMarkerText.trim()) return null;
    const needle = footerMarkerText.toLowerCase().trim();
    const colIdx = footerMarkerColumnIndex - 1;
    for (let r = headerRowIndex; r < file.grid.length; r++) {
      const cell = file.grid[r][colIdx];
      if (cell != null && cell.toLowerCase().includes(needle)) return r;
    }
    return null;
  }, [file, headerRowIndex, footerMarkerColumnIndex, footerMarkerText]);

  // Same live-match idea as the footer marker, but a cash marker can match many rows (not a
  // single boundary) - every matching row is highlighted, not just the first.
  const cashMatchRowIndices = useMemo(() => {
    if (!file || cashMarkerColumnIndex == null || !cashMarkerText.trim()) return new Set<number>();
    const needle = cashMarkerText.toLowerCase().trim();
    const colIdx = cashMarkerColumnIndex - 1;
    const matches = new Set<number>();
    for (let r = headerRowIndex; r < file.grid.length; r++) {
      const cell = file.grid[r][colIdx];
      if (cell != null && cell.toLowerCase().includes(needle)) matches.add(r);
    }
    return matches;
  }, [file, headerRowIndex, cashMarkerColumnIndex, cashMarkerText]);

  // A previously-picked header string may no longer exist at all once the derived `headers`
  // array changes (it may have moved to a different column, or disappeared if the new
  // selection isn't actually a header row) - so any change to either index clears the
  // in-progress mapping, same as an individual mapping edit already clears `preview`.
  function updateIndices(nextHeaderRowIndex: number, nextDataStartColumnIndex: number) {
    setHeaderRowIndexState(nextHeaderRowIndex);
    setDataStartColumnIndexState(nextDataStartColumnIndex);
    setHeaderRowText(String(nextHeaderRowIndex));
    setDataStartColumnText(String(nextDataStartColumnIndex));
    setHeaderConfirmed(true);
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

  // Footer-pick mode: clicking a cell sets the marker's column and pre-fills its match text
  // from that cell's own content - still editable afterward (e.g. narrowing "Position Total"
  // down to just "Total"). Doesn't touch the mapping/preview, unlike a header-row change -
  // the footer marker is independent of which columns are mapped to which fields.
  function handleFooterCellClick(r: number, c: number) {
    setFooterMarkerColumnIndex(c + 1);
    setFooterMarkerColumnText(String(c + 1));
    setFooterMarkerText(file?.grid[r]?.[c] ?? '');
  }

  // Lets the footer marker's column be set by typing, not just by clicking a grid cell - the
  // gap reported live: typing straight into the marker text field alone did nothing, since the
  // column stayed unset and both are required together.
  function handleFooterMarkerColumnTextChange(raw: string) {
    setFooterMarkerColumnText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '') { setFooterMarkerColumnIndex(null); return; }
    if (!Number.isFinite(parsed)) return;
    setFooterMarkerColumnIndex(Math.min(Math.max(1, parsed), maxCols));
  }

  // Cash-pick mode: clicking a cell sets the marker's column and pre-fills its match text,
  // same as the footer marker's click handler.
  function handleCashCellClick(r: number, c: number) {
    setCashMarkerColumnIndex(c + 1);
    setCashMarkerColumnText(String(c + 1));
    setCashMarkerText(file?.grid[r]?.[c] ?? '');
  }

  function handleCashMarkerColumnTextChange(raw: string) {
    setCashMarkerColumnText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '') { setCashMarkerColumnIndex(null); return; }
    if (!Number.isFinite(parsed)) return;
    setCashMarkerColumnIndex(Math.min(Math.max(1, parsed), maxCols));
  }

  // Click-to-set for the cash value column (Pattern #1) - a bare column pointer, so no text
  // prefill the way the marker cell's click gets one.
  function handleCashValueCellClick(_r: number, c: number) {
    setCashValueColumnIndex(c + 1);
    setCashValueColumnText(String(c + 1));
  }

  function handleCashValueColumnTextChange(raw: string) {
    setCashValueColumnText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '') { setCashValueColumnIndex(null); return; }
    if (!Number.isFinite(parsed)) return;
    setCashValueColumnIndex(Math.min(Math.max(1, parsed), maxCols));
  }

  useEffect(() => {
    const key = `${headerRowIndex - 1}-${dataStartColumnIndex - 1}`;
    cellRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [headerRowIndex, dataStartColumnIndex]);

  useEffect(() => {
    if (footerMatchRowIdx == null || footerMarkerColumnIndex == null) return;
    const key = `${footerMatchRowIdx}-${footerMarkerColumnIndex - 1}`;
    cellRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [footerMatchRowIdx, footerMarkerColumnIndex]);

  useEffect(() => {
    if (cashMarkerColumnIndex == null || cashMatchRowIndices.size === 0) return;
    const firstMatch = Math.min(...cashMatchRowIndices);
    const key = `${firstMatch}-${cashMarkerColumnIndex - 1}`;
    cellRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cashMatchRowIndices, cashMarkerColumnIndex]);

  // Marks the preview as genuinely seen once its own end (a sentinel right after the holdings
  // table) scrolls into view - not just "a preview response arrived." "Use This Mapping" stays
  // disabled until then (see stageActions below).
  useEffect(() => {
    if (!preview || hasSeenPreview) return;
    const el = previewEndRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setHasSeenPreview(true);
    }, { threshold: 1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview, hasSeenPreview]);

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
    setHeaderConfirmed(false);
    setWizardStep('header');
    setFooterMarkerColumnIndex(null);
    setFooterMarkerText('');
    setFooterMarkerColumnText('');
    setCashMarkerColumnIndex(null);
    setCashMarkerText('');
    setCashMarkerColumnText('');
    setCashPickTarget('marker');
    setCashValueMode('auto');
    setCashValueColumnIndex(null);
    setCashValueColumnText('');

    try {
      const isExcel = EXCEL_EXTENSIONS.some((ext) => picked.name.toLowerCase().endsWith(ext));
      const content = isExcel ? await xlsxFileToCsv(picked) : await picked.text();
      // Hard limit on the sample file used to define a brand-new template - the grid must show
      // the whole file so the footer marker row is always clickable, and this app's
      // retail-investor portfolios rarely exceed ~100 holdings. Also enforced backend-side
      // (flexParser.service.ts's assertWithinTemplateSampleLimit) - this is fast client-side
      // feedback, not the authoritative check. Never applies to reusing an already-saved
      // template (this component is never even shown on that path).
      const totalLines = content.split(/\r\n|\n|\r/).length;
      if (totalLines > GRID_PREVIEW_ROWS) {
        setReadError(
          `Sample files for creating or changing a template must be at most ${GRID_PREVIEW_ROWS} rows ` +
          `(1 header + up to 200 data rows + 1 footer row). This file has ${totalLines} rows - trim it down, ` +
          'or use a smaller example. Once the template is saved, real uploads can have any number of holdings.',
        );
        return;
      }
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
  // Both-or-neither, consistently applied everywhere the footer marker is sent - a column with
  // no text (or vice versa) means "not really configured yet," so Inspect Data's preview always
  // matches exactly what Save Template would actually persist.
  const hasFooterMarker = footerMarkerColumnIndex !== null && !!footerMarkerText.trim();
  const hasCashMarker = cashMarkerColumnIndex !== null && !!cashMarkerText.trim();

  // Drives the stepper bar below - the last two DisplayStepKeys aren't real wizardStep values
  // (both happen while wizardStep === 'mapping'), so their status is derived from
  // mandatoryMapped/preview instead of a simple index comparison.
  const STAGE_ORDER: WizardStep[] = ['header', 'footer', 'cash', 'mapping'];
  function stepStatus(key: DisplayStepKey): 'done' | 'current' | 'upcoming' {
    const stageIdx = STAGE_ORDER.indexOf(wizardStep);
    if (key === 'header' || key === 'footer' || key === 'cash' || key === 'mapping') {
      const keyIdx = STAGE_ORDER.indexOf(key);
      if (key === 'mapping' && stageIdx === keyIdx) return mandatoryMapped ? 'done' : 'current';
      return stageIdx > keyIdx ? 'done' : stageIdx === keyIdx ? 'current' : 'upcoming';
    }
    if (stageIdx < 3) return 'upcoming'; // haven't reached the mapping stage yet
    if (key === 'inspectData') {
      if (!mandatoryMapped) return 'upcoming';
      return preview ? 'done' : 'current';
    }
    return preview ? 'current' : 'upcoming'; // confirmMapping - never "done", completing it exits the wizard
  }

  // The current stage's navigation action(s) - rendered as the left zone of the combined
  // stepper bar (see the JSX below) instead of at the bottom of each stage's own content, so
  // Back/Next/Skip and the step progress live on one line together.
  let stageActions: React.ReactNode = null;
  if (wizardStep === 'header') {
    stageActions = headerConfirmed ? (
      <button
        type="button"
        onClick={() => setWizardStep('footer')}
        data-testid="wizard-next-header"
        className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
      >
        Next →
      </button>
    ) : (
      <span className="text-sm text-text-muted">Confirm the header row to continue</span>
    );
  } else if (wizardStep === 'footer') {
    stageActions = (
      <>
        <button type="button" onClick={() => setWizardStep('header')} data-testid="wizard-back-footer" className="text-sm text-text-secondary hover:underline">
          ← Back
        </button>
        <button
          type="button"
          onClick={() => setWizardStep('cash')}
          data-testid="wizard-next-footer"
          className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
        >
          {hasFooterMarker ? 'Next →' : 'Skip footer marker →'}
        </button>
      </>
    );
  } else if (wizardStep === 'cash') {
    stageActions = (
      <>
        <button type="button" onClick={() => setWizardStep('footer')} data-testid="wizard-back-cash" className="text-sm text-text-secondary hover:underline">
          ← Back
        </button>
        <button
          type="button"
          onClick={() => setWizardStep('mapping')}
          data-testid="wizard-next-cash"
          className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
        >
          {hasCashMarker ? 'Next →' : 'Skip cash marker →'}
        </button>
      </>
    );
  }
  // wizardStep === 'mapping' is assigned below, once handleInspect/handleUseMapping exist -
  // that stage's actions (Inspect Data / Use This Mapping) need them.

  // The single object every downstream caller (Inspect Data, onReady) sends - mirrors
  // backend/src/services/flexParser.service.ts's CashConfig exactly. null when no marker is
  // configured at all; valueSource omitted for 'auto' (the implicit qty x price fallback).
  const cashConfig: CashConfig | null = hasCashMarker
    ? {
        markerColumnIndex: cashMarkerColumnIndex!,
        markerText: cashMarkerText.trim(),
        valueSource: cashValueMode === 'column' && cashValueColumnIndex != null
          ? { type: 'column', columnIndex: cashValueColumnIndex }
          : cashValueMode === 'embedded'
          ? { type: 'embedded' }
          : undefined,
      }
    : null;

  async function handleInspect() {
    if (!file || !mandatoryMapped) return;
    // A rejection is already surfaced via flexPreview.isError/error below - this catch
    // only stops it from becoming an unhandled promise rejection (mutateAsync's promise
    // isn't awaited by anything else here that would otherwise observe the rejection).
    try {
      const result = await flexPreview.mutateAsync({
        columnMapping: mapping,
        filename: file.filename,
        content: file.content,
        headerRowIndex,
        dataStartColumnIndex,
        footerMarkerColumnIndex: hasFooterMarker ? footerMarkerColumnIndex! : undefined,
        footerMarkerText: hasFooterMarker ? footerMarkerText.trim() : undefined,
        cashConfig: cashConfig ?? undefined,
      });
      setHasSeenPreview(false); // a fresh preview needs its own fresh scroll-to-review
      setPreview(result);
    } catch {
      // handled via flexPreview.isError
    }
  }

  function handleUseMapping() {
    if (!file || !preview) return;
    onReady({
      columnMapping: mapping, filename: file.filename, content: file.content, preview, headerRowIndex, dataStartColumnIndex,
      footerMarkerColumnIndex: hasFooterMarker ? footerMarkerColumnIndex : null,
      footerMarkerText: hasFooterMarker ? footerMarkerText.trim() : null,
      cashConfig,
    });
  }

  // wizardStep === 'mapping' covers 3 conceptual steps (Map Columns / Inspect Data / Confirm
  // Mapping) in this same left zone, same "one line" pattern as Header/Footer/Cash above -
  // Inspect Data and Use This Mapping moved up here from the bottom of their own sections.
  if (wizardStep === 'mapping') {
    stageActions = (
      <>
        <button type="button" onClick={() => setWizardStep('cash')} data-testid="wizard-edit-markers" className="text-sm text-text-secondary hover:underline">
          ← Edit header/footer/cash settings
        </button>
        {!preview ? (
          <button
            type="button"
            onClick={handleInspect}
            disabled={!mandatoryMapped || flexPreview.isPending}
            data-testid="flex-inspect-data"
            className="rounded-btn bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {flexPreview.isPending ? 'Inspecting…' : 'Inspect Data'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleUseMapping}
              disabled={!hasSeenPreview}
              data-testid="flex-use-mapping"
              className="rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              Use This Mapping →
            </button>
            {!hasSeenPreview && (
              <span className="text-xs text-text-muted" data-testid="flex-scroll-remark">
                Scroll down to review the preview data before continuing
              </span>
            )}
          </>
        )}
        <button type="button" onClick={onCancel} className="text-sm text-text-secondary hover:underline">
          Cancel
        </button>
      </>
    );
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
          {/* Combined bar: the current stage's navigation action(s) as a distinct left zone,
              a separator, then the step progress as a distinct right zone - one line instead
              of two, per live feedback moving Back/Next/Skip up to join the stepper. */}
          <div className="mb-2 flex items-stretch overflow-hidden rounded-card border border-border text-xs">
            <div className="flex flex-wrap items-center gap-2 bg-bg-secondary px-3 py-2">
              {stageActions}
            </div>
            <div className="w-px shrink-0 bg-border" />
            <div className="flex flex-wrap items-center gap-1 bg-bg-card px-3 py-2" data-testid="wizard-stepper">
              {DISPLAY_STEPS.map((step, i) => {
                const status = stepStatus(step.key);
                return (
                  <span key={step.key} className="flex items-center gap-1">
                    <span
                      data-testid={`wizard-step-${step.key}`}
                      data-state={status}
                      className={`rounded-btn px-2 py-1 font-medium ${
                        status === 'current' ? 'bg-accent text-white' : status === 'done' ? 'text-success' : 'text-text-muted'
                      }`}
                    >
                      {status === 'done' ? '✓ ' : `${i + 1}. `}{step.label}
                    </span>
                    {i < DISPLAY_STEPS.length - 1 && <span className="text-text-muted" aria-hidden="true">→</span>}
                  </span>
                );
              })}
            </div>
          </div>

          {wizardStep === 'header' && (
            <>
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
            </>
          )}

          {wizardStep === 'footer' && (
            <>
              <p className="mb-2 text-xs text-text-muted">
                Optionally click the cell that marks where footer content (totals, disclaimers) begins — everything
                from that row on will be excluded. Skip if this file has no footer to trim.
              </p>
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <label className="flex items-center gap-1 text-sm text-text-primary">
                  Footer marker column <span className="font-normal text-text-muted">(optional)</span>
                  <input
                    type="number"
                    min={1}
                    max={maxCols}
                    value={footerMarkerColumnText}
                    onChange={(e) => handleFooterMarkerColumnTextChange(e.target.value)}
                    onBlur={() => setFooterMarkerColumnText(footerMarkerColumnIndex === null ? '' : String(footerMarkerColumnIndex))}
                    data-testid="flex-footer-marker-column-input"
                    className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-text-primary">
                  Footer marker text
                  <input
                    type="text"
                    value={footerMarkerText}
                    onChange={(e) => setFooterMarkerText(e.target.value)}
                    placeholder='e.g. "Total"'
                    data-testid="flex-footer-marker-text"
                    className="w-56 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                  />
                </label>
                {(footerMarkerColumnIndex !== null || footerMarkerText) && (
                  <button
                    type="button"
                    onClick={() => { setFooterMarkerColumnIndex(null); setFooterMarkerColumnText(''); setFooterMarkerText(''); }}
                    data-testid="flex-footer-marker-clear"
                    className="text-sm text-text-secondary hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {footerMarkerColumnIndex !== null && footerMarkerText.trim() && (
                <p className="mb-2 text-xs text-text-muted">
                  {footerMatchRowIdx !== null
                    ? <>Matches row {footerMatchRowIdx + 1} in this sample file — highlighted below.</>
                    : 'No row in this sample file matches yet — check the column number and text.'}
                </p>
              )}
            </>
          )}

          {wizardStep === 'cash' && (
            <>
              <p className="mb-2 text-xs text-text-muted">
                Optionally click a cell identifying cash/cash-equivalent rows (e.g. "Cash & Cash Investments") —
                every matching row is excluded from holdings and its value added to the portfolio's cash balance
                instead. Skip if this file has no cash rows to identify.
              </p>
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <label className="flex items-center gap-1 text-sm text-text-primary">
                  Cash marker column <span className="font-normal text-text-muted">(optional)</span>
                  <input
                    type="number"
                    min={1}
                    max={maxCols}
                    value={cashMarkerColumnText}
                    onChange={(e) => handleCashMarkerColumnTextChange(e.target.value)}
                    onBlur={() => setCashMarkerColumnText(cashMarkerColumnIndex === null ? '' : String(cashMarkerColumnIndex))}
                    data-testid="flex-cash-marker-column-input"
                    className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-text-primary">
                  Cash marker text
                  <input
                    type="text"
                    value={cashMarkerText}
                    onChange={(e) => setCashMarkerText(e.target.value)}
                    placeholder='e.g. "Cash & Cash Investments"'
                    data-testid="flex-cash-marker-text"
                    className="w-56 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                  />
                </label>
                {(cashMarkerColumnIndex !== null || cashMarkerText || cashValueColumnIndex !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCashMarkerColumnIndex(null); setCashMarkerColumnText(''); setCashMarkerText('');
                      setCashValueMode('auto'); setCashValueColumnIndex(null); setCashValueColumnText('');
                      setCashPickTarget('marker');
                    }}
                    data-testid="flex-cash-marker-clear"
                    className="text-sm text-text-secondary hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {cashMarkerColumnIndex !== null && cashMarkerText.trim() && (
                <p className="mb-2 text-xs text-text-muted">
                  {cashMatchRowIndices.size > 0
                    ? <>Matches {cashMatchRowIndices.size} row{cashMatchRowIndices.size === 1 ? '' : 's'} in this sample file — highlighted below.</>
                    : 'No row in this sample file matches yet — check the column number and text.'}
                </p>
              )}

              {hasCashMarker && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-text-primary">Value:</span>
                  <button
                    type="button"
                    onClick={() => { setCashValueMode('auto'); setCashPickTarget('marker'); }}
                    aria-pressed={cashValueMode === 'auto'}
                    data-testid="cash-value-mode-auto"
                    className={`rounded-btn px-3 py-1.5 text-sm ${cashValueMode === 'auto' ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'}`}
                  >
                    Auto (qty × price)
                  </button>
                  <button
                    type="button"
                    // Auto-switches the grid's click target to "value" - by the time this mode
                    // is even reachable the marker is already confirmed (hasCashMarker gates
                    // this whole toggle), so the very next click should safely set the value
                    // column, not silently re-fire the marker-click handler and clobber it.
                    // (Real bug, live-caught: clicking the value cell right after switching to
                    // this mode was overwriting the marker with the value cell's own contents.)
                    onClick={() => { setCashValueMode('column'); setCashPickTarget('value'); }}
                    aria-pressed={cashValueMode === 'column'}
                    data-testid="cash-value-mode-column"
                    className={`rounded-btn px-3 py-1.5 text-sm ${cashValueMode === 'column' ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'}`}
                  >
                    Separate column
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCashValueMode('embedded'); setCashPickTarget('marker'); }}
                    aria-pressed={cashValueMode === 'embedded'}
                    data-testid="cash-value-mode-embedded"
                    className={`rounded-btn px-3 py-1.5 text-sm ${cashValueMode === 'embedded' ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'}`}
                  >
                    Embedded in this cell
                  </button>
                </div>
              )}

              {hasCashMarker && cashValueMode === 'column' && (
                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="flex items-center gap-1 text-sm text-text-primary">
                    Cash value column
                    <input
                      type="number"
                      min={1}
                      max={maxCols}
                      value={cashValueColumnText}
                      onChange={(e) => handleCashValueColumnTextChange(e.target.value)}
                      onBlur={() => setCashValueColumnText(cashValueColumnIndex === null ? '' : String(cashValueColumnIndex))}
                      data-testid="flex-cash-value-column-input"
                      className="w-16 rounded-btn border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCashPickTarget('marker')}
                      aria-pressed={cashPickTarget === 'marker'}
                      data-testid="cash-pick-marker"
                      className={`rounded-btn px-3 py-1.5 text-sm ${cashPickTarget === 'marker' ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'}`}
                    >
                      Set cash marker
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashPickTarget('value')}
                      aria-pressed={cashPickTarget === 'value'}
                      data-testid="cash-pick-value"
                      className={`rounded-btn px-3 py-1.5 text-sm ${cashPickTarget === 'value' ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-bg-primary'}`}
                    >
                      Set cash value column
                    </button>
                  </div>
                </div>
              )}
              {hasCashMarker && cashValueMode === 'auto' && (
                <p className="mb-2 text-xs text-text-muted">Matched cash rows will use quantity × current price.</p>
              )}
            </>
          )}

          <div className="max-h-64 overflow-auto rounded-card border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <tbody>
                {file.grid.map((row, r) => {
                  // Gated on headerConfirmed - headerRowIndex defaults to 1 before the user has
                  // chosen anything, so without this gate row 1 would look specially selected
                  // the instant a file loads, before any real interaction (reported live).
                  const isHeaderRow = headerConfirmed && r === headerRowIndex - 1;
                  const isFooterMatchRow = r === footerMatchRowIdx;
                  const isCashMatchRow = cashMatchRowIndices.has(r);
                  return (
                    <tr
                      key={r}
                      data-testid={isFooterMatchRow ? 'flex-footer-match-row' : isCashMatchRow ? 'flex-cash-match-row' : undefined}
                      className={isFooterMatchRow ? 'bg-yellow-300' : isCashMatchRow ? 'bg-blue-300' : isHeaderRow ? 'bg-green-300' : ''}
                    >
                      <td className="border border-border bg-bg-secondary px-2 py-1 text-right font-mono text-text-muted">
                        {r + 1}
                      </td>
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
                              onClick={() => {
                                if (wizardStep === 'header') updateIndices(r + 1, c + 1);
                                else if (wizardStep === 'footer') handleFooterCellClick(r, c);
                                else if (wizardStep === 'cash') {
                                  if (cashPickTarget === 'value' && cashValueMode === 'column') handleCashValueCellClick(r, c);
                                  else handleCashCellClick(r, c);
                                }
                              }}
                              data-testid={`grid-cell-${r}-${c}`}
                              className={`block w-full whitespace-nowrap px-2 py-1 text-left hover:bg-accent/20 ${
                                isActive ? 'bg-accent/30 font-semibold' : ''
                              } ${
                                isFooterMatchRow || isCashMatchRow || isHeaderRow
                                  ? 'font-semibold text-black' // solid yellow/blue/green need fixed dark text, not the theme-dependent tokens below
                                  : isSkippedRow || isSkippedCol ? 'text-text-muted' : 'text-text-primary'
                              }`}
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

      {file && wizardStep === 'mapping' && (
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

      {flexPreview.isError && (
        <p className="text-sm text-danger">
          {flexPreview.error instanceof ApiError ? flexPreview.error.message : 'Could not parse the file against this mapping.'}
        </p>
      )}

      {preview && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-primary">4. Preview (first 5 records)</h3>
          <p className="mb-2 text-sm text-text-secondary" data-testid="flex-preview-cash-amount">
            Cash detected: <span className="font-medium text-text-primary">{formatCurrency(preview.cashAmount)}</span>
          </p>
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
          {/* Sentinel for the "scroll to review" gate on Use This Mapping (now in the stepper
              bar's left zone, above) - once this scrolls into view, the user has genuinely seen
              the whole preview table, not just triggered a response. */}
          <div ref={previewEndRef} data-testid="flex-preview-end" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
