// Jira's "Export → CSV (all fields)" file: RFC 4180 records whose header
// repeats a name once per value (Labels, Comment, Sprint, Component/s…).

const DELIMITERS = [",", ";", "\t"] as const;

export type JiraCsvTable = {
  /** Header names, trimmed, in file order (repeats kept). */
  headers: string[];
  /** Data rows (blank lines dropped), each with its 1-based file row. */
  rows: Array<{ line: number; cells: string[] }>;
};

export type JiraCsvError = "empty" | "notCsv" | "notJira";

/**
 * Quoted fields, doubled quotes, delimiters and newlines inside quotes, CRLF
 * or LF. Returns null when a quoted field never closes.
 */
export function parseCsvRecords(
  text: string,
  delimiter: string,
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

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The delimiter whose header row has a Summary column; comma otherwise. */
function detectDelimiter(text: string): string {
  for (const delimiter of DELIMITERS) {
    const [header] = parseCsvRecords(text, delimiter, 1) ?? [];
    if (header?.some((name) => normalizeName(name) === "summary")) {
      return delimiter;
    }
  }
  return ",";
}

export function readJiraCsv(
  text: string,
): { ok: true; table: JiraCsvTable } | { ok: false; error: JiraCsvError } {
  const bomless = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const clean = bomless.replace(/\r\n?/g, "\n");
  if (clean.trim() === "") return { ok: false, error: "empty" };
  // Spreadsheets and other binary files contain NUL bytes; text never does.
  if (clean.includes("\u0000")) return { ok: false, error: "notCsv" };

  const records = parseCsvRecords(clean, detectDelimiter(clean));
  if (!records || records.length === 0) return { ok: false, error: "notCsv" };

  const [header = [], ...data] = records;
  const headers = header.map((name) => name.trim());
  if (!headers.some((name) => normalizeName(name) === "summary")) {
    return { ok: false, error: "notJira" };
  }

  const rows: JiraCsvTable["rows"] = [];
  // Track the file line of each record for error messages: a record spans as
  // many lines as its quoted newlines.
  let line = 1 + newlineCount(header);
  for (const cells of data) {
    line += 1;
    const span = newlineCount(cells);
    if (cells.some((cell) => cell.trim() !== "")) rows.push({ line, cells });
    line += span;
  }
  if (rows.length === 0) return { ok: false, error: "empty" };
  return { ok: true, table: { headers, rows } };
}

function newlineCount(cells: readonly string[]) {
  let count = 0;
  for (const cell of cells) {
    for (const char of cell) if (char === "\n") count += 1;
  }
  return count;
}

/**
 * Reads cells by header name, case-insensitively, collecting every column
 * that repeats the name.
 */
export class JiraColumns {
  private readonly byName = new Map<string, number[]>();

  constructor(readonly headers: readonly string[]) {
    headers.forEach((name, index) => {
      const key = normalizeName(name);
      if (!key) return;
      const indexes = this.byName.get(key) ?? [];
      indexes.push(index);
      this.byName.set(key, indexes);
    });
  }

  has(...names: string[]) {
    return names.some((name) => this.byName.has(normalizeName(name)));
  }

  /** Every non-blank value of the first listed name present in the file. */
  all(cells: readonly string[], ...names: string[]): string[] {
    for (const name of names) {
      const indexes = this.byName.get(normalizeName(name));
      if (!indexes) continue;
      return indexes
        .map((index) => (cells[index] ?? "").trim())
        .filter((value) => value !== "");
    }
    return [];
  }

  /** The first non-blank value of the first listed name present. */
  one(cells: readonly string[], ...names: string[]): string {
    return this.all(cells, ...names)[0] ?? "";
  }

  /** Header names with how many columns share each, in file order. */
  distinct(): Array<{ name: string; count: number }> {
    const seen = new Map<string, { name: string; count: number }>();
    for (const name of this.headers) {
      const key = normalizeName(name);
      if (!key) continue;
      const entry = seen.get(key);
      if (entry) entry.count += 1;
      else seen.set(key, { name: name.trim(), count: 1 });
    }
    return [...seen.values()];
  }

  /** Headers matching a pattern, e.g. the issue link columns. */
  matching(pattern: RegExp): Array<{ name: string; index: number }> {
    return this.headers.flatMap((name, index) =>
      pattern.test(name.trim()) ? [{ name: name.trim(), index }] : [],
    );
  }
}
