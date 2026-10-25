export interface CsvRecord {
  readonly cells: string[];
  /** Position of the record in the file, counting blank ones, as a spreadsheet numbers its rows. */
  readonly row: number;
}

/**
 * Minimal RFC 4180 reader: quoted fields may hold commas, newlines and doubled quotes. Blank
 * records are dropped, but still counted in `row`, so a message names the row the author sees.
 */
export function parseCsvRecords(text: string): CsvRecord[] {
  const all: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); all.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); all.push(row); }
  return all.flatMap((cells, i) => (cells.some((f) => f.trim() !== '') ? [{ cells, row: i + 1 }] : []));
}

export const parseCsv = (text: string): string[][] => parseCsvRecords(text).map((r) => r.cells);
