// Portfolio Upload - Flex. Reuses parser.service.ts's buildHoldingsFromMappedRows() for all
// the actual value parsing/derivation - the only thing genuinely different from Legacy is how
// `map` (target field -> column index) gets built: HEADER_ALIASES/mapHeaders() for Legacy,
// a user-defined/saved column mapping for Flex.

import Papa from 'papaparse';
import { buildHoldingsFromMappedRows, ParseResult } from './parser.service';

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

export interface ParseFlexCsvOptions {
  headerRowIndex?: number; // 1-based: 1 = the file's first row (as a human reads a spreadsheet)
  dataStartColumnIndex?: number; // 1-based: 1 = the file's first column
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
export function parseFlexCsv(
  text: string,
  columnMapping: ColumnMapping,
  options: ParseFlexCsvOptions = {},
): ParseResult {
  const { headerRowIndex = 1, dataStartColumnIndex = 1 } = options;
  const aoa = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
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

  const headers = headerRow.slice(dataStartArrIdx);
  const rows = aoa.slice(headerRowArrIdx + 1).map((row) => {
    const sliced = row.slice(dataStartArrIdx);
    return Object.fromEntries(headers.map((h, i) => [h, sliced[i] ?? '']));
  });
  if (!rows.length) throw new Error('CSV appears to be empty or could not be parsed.');

  const map = resolveMapping(headers, columnMapping);
  return buildHoldingsFromMappedRows(rows, map);
}
