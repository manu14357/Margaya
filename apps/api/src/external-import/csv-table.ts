import { JiraColumns, parseCsvRecords } from "../jira-import/csv";

// The CSV exports of Linear and Asana: RFC 4180, comma separated, one
// header row. The Jira importer's parser and column reader do the work.

export type CsvReadError = "empty" | "notCsv" | "wrongFormat";

export type CsvTable = {
  columns: JiraColumns;
  rows: Array<{ line: number; cells: string[] }>;
};

function newlineCount(cells: readonly string[]) {
  let count = 0;
  for (const cell of cells) {
    for (const char of cell) if (char === "\n") count += 1;
  }
  return count;
}

/**
 * Reads the file when its header has every `required` column (matched
 * case-insensitively); else `wrongFormat`, so a Jira or Asana file dropped
 * on the Linear importer is refused rather than half read.
 */
export function readCsvTable(
  content: string,
  required: readonly string[],
): { ok: true; table: CsvTable } | { ok: false; error: CsvReadError } {
  const bomless = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const clean = bomless.replace(/\r\n?/g, "\n");
  if (clean.trim() === "") return { ok: false, error: "empty" };
  if (clean.includes("\u0000")) return { ok: false, error: "notCsv" };
  const records = parseCsvRecords(clean, ",");
  if (!records || records.length === 0) return { ok: false, error: "notCsv" };

  const [header = [], ...data] = records;
  const columns = new JiraColumns(header.map((name) => name.trim()));
  if (!required.every((name) => columns.has(name))) {
    return { ok: false, error: "wrongFormat" };
  }
  const rows: CsvTable["rows"] = [];
  let line = 1 + newlineCount(header);
  for (const cells of data) {
    line += 1;
    const span = newlineCount(cells);
    if (cells.some((cell) => cell.trim() !== "")) rows.push({ line, cells });
    line += span;
  }
  if (rows.length === 0) return { ok: false, error: "empty" };
  return { ok: true, table: { columns, rows } };
}
