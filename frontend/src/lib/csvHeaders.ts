// Detects headers / a raw preview grid for the Flex mapping wizard — a quote-aware,
// client-side CSV line splitter. Not a full parser (no embedded-newline-in-quoted-field
// handling); the backend's real Papa.parse is still the authoritative parse. This only drives
// what the mapping wizard shows/lets the user click.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { inQuotes = false; }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());

  return cells;
}

// Just line 0 — a lightweight header-only helper for callers that don't need the rest of the
// file (e.g. anything that doesn't care where the real header row is).
export function parseCsvHeaderRow(content: string): string[] {
  const firstLine = content.split(/\r\n|\n|\r/)[0] ?? '';
  return splitCsvLine(firstLine).filter((h) => h.length > 0);
}

// A bounded raw-row grid for the mapping wizard's "confirm header row & data start column"
// step. Deliberately does NOT filter empty cells like parseCsvHeaderRow does — a grid row's
// cell *positions* must line up 1:1 with real column numbers, since the user is clicking a
// cell to set dataStartColumnIndex (1-based; see flexParser.service.ts on the backend for the
// matching convention).
export function parseCsvGrid(content: string, maxRows = 50): string[][] {
  return content.split(/\r\n|\n|\r/).slice(0, maxRows).map((line) => splitCsvLine(line));
}
