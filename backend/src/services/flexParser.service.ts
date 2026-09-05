// Portfolio Upload - Flex. Reuses parser.service.ts's buildHoldingsFromMappedRows() for all
// the actual value parsing/derivation - the only thing genuinely different from Legacy is how
// `map` (target field -> column index) gets built: HEADER_ALIASES/mapHeaders() for Legacy,
// a user-defined/saved column mapping for Flex.

import Papa from 'papaparse';
import { buildHoldingsFromMappedRows, parseCashAmt, ParseResult } from './parser.service';
import { parseNum } from '../utils/formatters';

export const MANDATORY_TARGET_FIELDS = ['symbol', 'quantity', 'currentPrice'] as const;
export const OPTIONAL_TARGET_FIELDS = ['purchasePrice', 'name', 'sector', 'purchaseDate'] as const;
export const ALL_TARGET_FIELDS = [...MANDATORY_TARGET_FIELDS, ...OPTIONAL_TARGET_FIELDS] as const;

// { targetField: sourceHeaderText } - what a template's dtls rows / the mapping screen's
// in-progress selections look like on the wire.
export type ColumnMapping = Record<string, string>;

export class FlexMappingMismatchError extends Error {}

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_-]/g, ' ');
}

// Resolves a saved/proposed column mapping against a real file's actual header row - a
// template's source_header values are matched by normalized text, not position, so a later
// upload with reordered (but same-named) columns still resolves correctly. Throws naming
// every target field whose mapped header isn't present in this file, which is exactly the
// "this template no longer matches this file" case (e.g. the broker renamed a column).
export function resolveMapping(headers: string[], columnMapping: ColumnMapping): Record<string, number> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const map: Record<string, number> = {};
  const unresolved: string[] = [];

  for (const [targetField, sourceHeader] of Object.entries(columnMapping)) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(sourceHeader));
    if (idx === -1) { unresolved.push(`${targetField} ("${sourceHeader}")`); continue; }
    map[targetField] = idx;
  }

  if (unresolved.length) {
    throw new FlexMappingMismatchError(
      `This file's headers don't match the mapping: ${unresolved.join(', ')} not found. Headers found: ${headers.join(', ')}`,
    );
  }

  const missing = MANDATORY_TARGET_FIELDS.filter((f) => !(f in map));
  if (missing.length) {
    throw new FlexMappingMismatchError(`Mapping is missing mandatory fields: ${missing.join(', ')}.`);
  }

  return map;
}

// Cash/cash-equivalent row identification - a (column, "contains" text) marker pair, same raw
// coordinate space as the footer marker, but can match MULTIPLE rows (not a single boundary).
// valueSource is optional and describes where the dollar amount comes from once a row matches:
// - 'column': a separate column holds the value (Pattern #1 - e.g. Fidelity's cash row has the
//   label in one column, the balance in another).
// - 'embedded': the value is fused into the SAME cell as the marker text itself (Pattern #2 -
//   e.g. "Cash, Money Funds and Bank Deposits: $2,143.67").
// Omitted entirely = the implicit fallback: quantity x currentPrice, same shape as
// parser.service.ts's own Legacy cash-row handling. A discriminated union so future patterns can
// be added without another migration each time - see migration 031.
export type CashValueSource =
  | { type: 'column'; columnIndex: number }
  | { type: 'embedded' };

export interface CashConfig {
  markerColumnIndex: number;
  markerText: string;
  valueSource?: CashValueSource;
}

export interface ParseFlexCsvOptions {
  headerRowIndex?: number; // 1-based: 1 = the file's first row (as a human reads a spreadsheet)
  dataStartColumnIndex?: number; // 1-based: 1 = the file's first column
  // 1-based, same raw coordinate space as dataStartColumnIndex. Both footer options must be
  // given together (enforced by callers, not here) - if either is omitted, no footer trimming
  // happens and the file parses to its real end, exactly like before this option existed.
  footerMarkerColumnIndex?: number;
  footerMarkerText?: string;
  cashConfig?: CashConfig;
}

// Validates/coerces an untrusted wire payload's `cashConfig` field into a real CashConfig (or
// undefined if malformed/absent) - shared by every controller accepting one
// (portfolio.controller.ts, portfolioTemplate.controller.ts), so the shape check lives in one
// place alongside the type it validates.
export function coerceCashConfig(raw: unknown): CashConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.markerColumnIndex !== 'number' || typeof c.markerText !== 'string' || !c.markerText.trim()) return undefined;

  let valueSource: CashValueSource | undefined;
  if (c.valueSource && typeof c.valueSource === 'object' && !Array.isArray(c.valueSource)) {
    const vs = c.valueSource as Record<string, unknown>;
    if (vs.type === 'column' && typeof vs.columnIndex === 'number') {
      valueSource = { type: 'column', columnIndex: vs.columnIndex };
    } else if (vs.type === 'embedded') {
      valueSource = { type: 'embedded' };
    }
  }

  return { markerColumnIndex: c.markerColumnIndex, markerText: c.markerText, valueSource };
}

// Pattern #2: takes the LAST currency-looking token in the full cell text (the value
// conventionally follows the label) and reuses parseCashAmt's existing $/,/parenthetical-negative
// handling unchanged - no new number-parsing logic, just a different source string. Works even
// when the label itself contains a stray digit (verified: "Q4 Cash Reserve 1234.56" still
// extracts 1234.56, since it's the LAST match, not the first) - not just the clean case.
export function extractEmbeddedCashAmt(cellText: string): number | null {
  const matches = cellText.match(/\(?-?\$?[\d,]+(?:\.\d+)?\)?/g);
  if (!matches?.length) return null;
  return parseCashAmt(matches[matches.length - 1]);
}

// Portfolio Upload - Flex's max sample-file size for defining a brand-new template (1 header +
// 200 data rows + 1 footer row) - see CLAUDE.md's Config Properties-adjacent "Flex CSV Parsing"
// section for the full reasoning: the mapping wizard's grid must show the *entire* sample file
// so the footer marker row is always clickable, and this app's retail-investor portfolios
// rarely exceed ~100 holdings, so 200 leaves real headroom. A hard limit, not a soft warning -
// enforced both here (authoritative) and in the wizard's own file-selection check (fast
// feedback). Never applies to reusing an already-saved template - only to defining a new one.
export const MAX_TEMPLATE_SAMPLE_LINES = 202;

export class TemplateSampleTooLargeError extends Error {}

export function assertWithinTemplateSampleLimit(text: string): void {
  const lineCount = text.split(/\r\n|\n|\r/).length;
  if (lineCount > MAX_TEMPLATE_SAMPLE_LINES) {
    throw new TemplateSampleTooLargeError(
      `Sample files for creating or changing a template must be at most ${MAX_TEMPLATE_SAMPLE_LINES} rows ` +
      `(1 header + up to 200 data rows + 1 footer row). This file has ${lineCount} rows - trim it down, ` +
      'or use a smaller example. Once the template is saved, real uploads can have any number of holdings.',
    );
  }
}

// Always a full parse (never limited to a preview slice) - mirrors Legacy's own dryRun
// precedent of parsing everything and only skipping the DB write, so errors anywhere in the
// file surface immediately rather than only in a 5-row sample. Callers wanting an
// "Inspect Data" preview just slice result.data themselves.
//
// headerRowIndex/dataStartColumnIndex are 1-based (matching what's stored on a template and
// shown in the mapping wizard) - converted to a 0-based array index right here, the one place
// that actually needs it. Real broker exports (e.g. Charles Schwab) put preamble/account-info
// rows above the real header row and sometimes a leading label column before real data - these
// two options let a saved template skip past both instead of always assuming row 1/column 1.
//
// No skipEmptyLines - array indices must line up 1:1 with the wizard's own raw line-based grid
// (frontend/src/lib/csvHeaders.ts's parseCsvGrid), which counts every line including blanks.
// Dropping blank lines here silently shifted the two out of sync (confirmed live: a blank
// preamble line before the real header row made this function read the wrong row entirely,
// once as a data row). A stray blank row surviving into the data area is already tolerated by
// buildHoldingsFromMappedRows() (no symbol -> silently skipped), so this is safe.
export function parseFlexCsv(
  text: string,
  columnMapping: ColumnMapping,
  options: ParseFlexCsvOptions = {},
): ParseResult {
  const {
    headerRowIndex = 1, dataStartColumnIndex = 1, footerMarkerColumnIndex, footerMarkerText, cashConfig,
  } = options;
  const aoa = Papa.parse<string[]>(text).data;
  if (!aoa.length) throw new Error('CSV appears to be empty or could not be parsed.');

  if (headerRowIndex < 1 || headerRowIndex > aoa.length) {
    throw new Error(`Header row ${headerRowIndex} is out of range for this file (it has ${aoa.length} row(s)).`);
  }
  const headerRowArrIdx = headerRowIndex - 1;
  const headerRow = aoa[headerRowArrIdx];
  if (dataStartColumnIndex < 1 || dataStartColumnIndex > headerRow.length) {
    throw new Error(`Data start column ${dataStartColumnIndex} is out of range for this file's header row (it has ${headerRow.length} column(s)).`);
  }
  const dataStartArrIdx = dataStartColumnIndex - 1;

  // Footer boundary: the first raw row (after the header) whose cell at footerMarkerColumnIndex
  // contains footerMarkerText (case-insensitive) - checked against the RAW row, before the
  // dataStartColumnIndex slice below, so footerMarkerColumnIndex shares the same absolute
  // coordinate space as headerRowIndex/dataStartColumnIndex with no translation math. If no row
  // matches, dataEndArrIdx stays at the real end of file - not an error, since a future upload
  // isn't guaranteed to always contain a totals/footer row.
  let dataEndArrIdx = aoa.length;
  if (footerMarkerColumnIndex != null && footerMarkerText) {
    const needle = footerMarkerText.toLowerCase().trim();
    const footerColArrIdx = footerMarkerColumnIndex - 1;
    for (let i = headerRowArrIdx + 1; i < aoa.length; i++) {
      const cell = aoa[i][footerColArrIdx];
      if (cell != null && cell.toLowerCase().includes(needle)) { dataEndArrIdx = i; break; }
    }
  }

  const headers = headerRow.slice(dataStartArrIdx);
  const map = resolveMapping(headers, columnMapping);

  // Cash/cash-equivalent rows: every raw row (between the header and the footer boundary)
  // whose cell at cashConfig.markerColumnIndex contains cashConfig.markerText is pulled out of
  // the holdings entirely and its dollar value redirected into flexCashAmount instead - unlike
  // the footer marker, this can match many rows, not just one boundary.
  const cashRowArrIndices = new Set<number>();
  let flexCashAmount = 0;
  if (cashConfig) {
    const needle = cashConfig.markerText.toLowerCase().trim();
    const markerColArrIdx = cashConfig.markerColumnIndex - 1;
    for (let i = headerRowArrIdx + 1; i < dataEndArrIdx; i++) {
      const markerCell = aoa[i][markerColArrIdx];
      if (markerCell == null || !markerCell.toLowerCase().includes(needle)) continue;
      cashRowArrIndices.add(i);

      let amt: number | null = null;
      if (cashConfig.valueSource?.type === 'column') {
        amt = parseCashAmt(aoa[i][cashConfig.valueSource.columnIndex - 1]);
      } else if (cashConfig.valueSource?.type === 'embedded') {
        amt = extractEmbeddedCashAmt(markerCell);
      }
      if (amt == null) {
        // Fallback: quantity x currentPrice using this row's already-mapped fields, same shape
        // as parser.service.ts's own Legacy cash-row handling. Applies when valueSource is
        // absent entirely, OR when the chosen source didn't actually yield a number.
        const sliced = aoa[i].slice(dataStartArrIdx);
        const rowVals = headers.map((_h, idx) => sliced[idx] ?? '');
        const qty = parseNum(rowVals[map.quantity]);
        const cp = parseNum(rowVals[map.currentPrice]);
        amt = (qty != null && cp != null) ? qty * cp : null;
      }
      if (amt != null) flexCashAmount += amt;
    }
  }

  const rows = aoa.slice(headerRowArrIdx + 1, dataEndArrIdx)
    .map((row, offset) => ({ row, arrIdx: headerRowArrIdx + 1 + offset }))
    .filter(({ arrIdx }) => !cashRowArrIndices.has(arrIdx))
    .map(({ row }) => {
      const sliced = row.slice(dataStartArrIdx);
      return Object.fromEntries(headers.map((h, i) => [h, sliced[i] ?? '']));
    });
  if (!rows.length) throw new Error('CSV appears to be empty or could not be parsed.');

  const result = buildHoldingsFromMappedRows(rows, map);
  return { ...result, cashAmount: result.cashAmount + flexCashAmount };
}
