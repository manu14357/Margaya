export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

export const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export type CsvReadError = "empty" | "tooLarge" | "tooManyRows" | "notCsv";

export type CsvTable = {
  /** One name per column; blank when the file has none for it. */
  headers: string[];
  /** Data rows, header excluded. Rows may be shorter than `headers`. */
  rows: string[][];
  /** The spreadsheet row number of `rows[0]` (2 after a header row). */
  firstRowNumber: number;
};

export type CsvReadResult =
  | { ok: true; delimiter: CsvDelimiter; table: CsvTable }
  | { ok: false; error: CsvReadError };

const DETECTION_SAMPLE = 20;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isBlankRecord(record: readonly string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}

/**
 * RFC 4180 records: quoted fields, doubled quotes, delimiters and newlines
 * inside quotes, CRLF or LF, an optional trailing newline. A quote in the
 * middle of an unquoted field is kept as text. Returns null when a quoted
 * field never closes; stops early after `limit` records.
 */
export function parseRecords(
  text: string,
  delimiter: CsvDelimiter,
  limit = Number.POSITIVE_INFINITY,
): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      index += 1;
      continue;
    }

    if (char === delimiter) {
      record.push(field);
      field = "";
      atFieldStart = true;
      index += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      atFieldStart = true;
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      if (records.length >= limit) return records;
      continue;
    }

    field += char;
    atFieldStart = false;
    index += 1;
  }

  if (inQuotes) return null;
  if (!atFieldStart || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Comma, semicolon or tab: whichever splits the first non-empty line into the
 * most fields consistently over the first 20 non-empty lines. When no
 * candidate is consistent, the widest first line wins. Ties go to comma.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  let best: CsvDelimiter = ",";
  let bestScore: [number, number] = [-1, -1];

  for (const delimiter of CSV_DELIMITERS) {
    const sample = (parseRecords(text, delimiter, DETECTION_SAMPLE * 2) ?? [])
      .filter((record) => !isBlankRecord(record))
      .slice(0, DETECTION_SAMPLE);
    const width = sample[0]?.length ?? 0;
    if (width === 0) continue;
    const consistent = sample.every((record) => record.length === width);
    const score: [number, number] = [consistent ? width : 1, width];
    if (
      score[0] > bestScore[0] ||
      (score[0] === bestScore[0] && score[1] > bestScore[1])
    ) {
      best = delimiter;
      bestScore = score;
    }
  }

  return best;
}

function utf8Length(text: string): number {
  // Every UTF-16 unit encodes to at most 3 bytes: skip encoding small files.
  if (text.length * 3 <= MAX_CSV_BYTES) return text.length;
  return new TextEncoder().encode(text).length;
}

/**
 * Reads a CSV file's text into a table, applying the 5 MB and 5,000-row
 * limits. Fully blank lines are kept (they hold their row numbers) but are
 * not counted as rows.
 */
export function readCsv(
  text: string,
  options: { delimiter?: CsvDelimiter; hasHeader?: boolean } = {},
): CsvReadResult {
  const clean = stripBom(text);
  if (utf8Length(clean) > MAX_CSV_BYTES)
    return { ok: false, error: "tooLarge" };
  if (clean.trim() === "") return { ok: false, error: "empty" };
  // Binary files (spreadsheets, images) contain NUL bytes; text never does.
  if (clean.includes("\u0000")) return { ok: false, error: "notCsv" };

  const delimiter = options.delimiter ?? detectDelimiter(clean);
  const records = parseRecords(clean, delimiter);
  if (!records) return { ok: false, error: "notCsv" };

  const hasHeader = options.hasHeader ?? true;
  const headerRecord = hasHeader ? (records[0] ?? []) : [];
  const rows = hasHeader ? records.slice(1) : records;
  const dataRows = rows.filter((row) => !isBlankRecord(row)).length;
  if (dataRows === 0) return { ok: false, error: "empty" };
  if (dataRows > MAX_CSV_ROWS) return { ok: false, error: "tooManyRows" };

  let width = headerRecord.length;
  for (const row of rows) width = Math.max(width, row.length);
  const headers = Array.from(
    { length: width },
    (_, column) => headerRecord[column]?.trim() ?? "",
  );

  return {
    ok: true,
    delimiter,
    table: { headers, rows, firstRowNumber: hasHeader ? 2 : 1 },
  };
}
