import * as XLSX from 'xlsx';
import { describe, expect, test, vi } from 'vitest';
import { xlsxFileToCsv } from './xlsxToCsv';

// xlsx's ESM named exports aren't configurable, so vi.spyOn(XLSX, 'read')
// can't redefine them directly — partial-mock the module instead, keeping
// every real export except `read` (which the 2 error-path tests below
// control per-test), so aoa_to_sheet/book_new/etc. used by makeXlsxFile stay
// real.
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof XLSX>();
  return { ...actual, read: vi.fn(actual.read) };
});

function makeXlsxFile(aoa: (string | number)[][], filename = 'test.xlsx'): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('xlsxFileToCsv', () => {
  test('converts a simple sheet to CSV text', async () => {
    const file = makeXlsxFile([
      ['Symbol', 'Quantity', 'Current Price'],
      ['AAPL', 10, 150],
    ]);
    const csv = await xlsxFileToCsv(file);
    expect(csv.trim()).toBe('Symbol,Quantity,Current Price\nAAPL,10,150');
  });

  // "Empower format" — a title/banner row above the real header, plus a
  // category string (EMPOWER_SECTOR_MAP territory) and a USD999997 cash
  // placeholder row. This function doesn't need to understand any of that —
  // it just converts the sheet as-is; parser.service.ts's header-row
  // detection + EMPOWER_SECTOR_MAP handle the rest server-side.
  test('converts an Empower-style sheet (banner row + category column + cash placeholder) as-is', async () => {
    const file = makeXlsxFile([
      ['My Empower Retirement Account'],
      ['Symbol', 'Quantity', 'Current Price', 'Market Value', 'Sector'],
      ['AAPL', 10, 150, 1500, 'Common Stocks'],
      ['USD999997', 1, 1, 500, 'Cash'],
    ]);
    const csv = await xlsxFileToCsv(file);
    const lines = csv.trim().split('\n');
    // sheet_to_csv pads every row out to the sheet's full (rectangular)
    // column range, so the 1-cell banner row gets trailing commas — that's
    // fine, findHeaderRowIndex() (parser.service.ts) only cares whether a
    // cell's *trimmed* value matches a known header, and empty cells never do.
    expect(lines[0].split(',')[0]).toBe('My Empower Retirement Account');
    expect(lines[1]).toBe('Symbol,Quantity,Current Price,Market Value,Sector');
    expect(lines[2]).toBe('AAPL,10,150,1500,Common Stocks');
    expect(lines[3]).toBe('USD999997,1,1,500,Cash');
  });

  test('surfaces a clear error when the workbook has no sheets', async () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} } as unknown as XLSX.WorkBook);
    const file = new File([new ArrayBuffer(4)], 'empty.xlsx');
    await expect(xlsxFileToCsv(file)).rejects.toThrow(/no sheets found/);
  });

  test('wraps a thrown parse error with a clear "Could not read Excel file" message', async () => {
    vi.mocked(XLSX.read).mockImplementationOnce(() => { throw new Error('Unsupported file'); });
    const file = new File([new ArrayBuffer(4)], 'bad.xlsx');
    await expect(xlsxFileToCsv(file)).rejects.toThrow(/Could not read Excel file: Unsupported file/);
  });
});
