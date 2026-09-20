import type { TableCell, TableModel } from "./table-model";

// CSV from a table model (B8 §4.8): every field quoted, inner quotes
// doubled, CRLF line endings and a byte-order mark so spreadsheet apps read
// UTF-8 names. Text cells that a spreadsheet would run as a formula get a
// leading apostrophe; numeric cells never do, so -3 stays a number.

const BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r\n]/;

function formatNumberCell(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Plain digits with a "." separator and no grouping; points keep 2 decimals.
  return String(Math.round(value * 100) / 100);
}

export function csvCell(value: TableCell): string {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === "number"
      ? formatNumberCell(value)
      : FORMULA_START.test(value)
        ? `'${value}`
        : value;
  return `"${text.replaceAll('"', '""')}"`;
}

/** The header, the rows as given (already sorted) and the total row last. */
export function toCsv(model: TableModel): string {
  const lines = [
    model.columns.map((column) => csvCell(column.label)).join(","),
  ];
  const rows = model.total ? [...model.rows, model.total] : model.rows;
  for (const row of rows) {
    lines.push(
      model.columns
        .map((column) => csvCell(row.cells[column.id] ?? null))
        .join(","),
    );
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
