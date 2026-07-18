import type * as XLSXType from 'xlsx';

// Converts an Excel file (.xls/.xlsx/.xlsm — the "Empower format" in the
// source app) to plain CSV text, client-side, mirroring the source app's
// processFile()/xlsxSheetToCsv() (js/portfolio.js:305-352). Only the first
// sheet is used, matching the source app (no multi-sheet handling).
//
// Deliberately does NOT do any header-row detection here (the source app's
// xlsxSheetToCsv() did, since it had access to HEADER_ALIASES) — that logic
// now lives server-side in parser.service.ts's parseGenericCsv(), since
// HEADER_ALIASES only exists there. This function's only job is mechanical
// format conversion; everything else flows through the exact same pipeline
// a native .csv upload already uses.
//
// `xlsx` is dynamically imported (~350KB) rather than a top-level import —
// Excel upload is an occasional action, not something every page load needs
// to pay for.
export async function xlsxFileToCsv(file: File): Promise<string> {
  const XLSX: typeof XLSXType = await import('xlsx');

  let workbook: XLSXType.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch (err) {
    throw new Error(`Could not read Excel file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Could not read Excel file: no sheets found.');

  return XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
}
