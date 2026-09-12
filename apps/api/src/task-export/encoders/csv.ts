import { type CellValue, cellText, isNumericCell } from "./cell";

// The CSV dialect every Margaya CSV uses: UTF-8 with a byte-order mark, CRLF
// line endings, every field quoted with inner quotes doubled, and text that
// a spreadsheet would read as a formula prefixed with an apostrophe.

export const CSV_BOM = "﻿";

const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

/** One field, quoted; text cells that start like a formula get a `'`. */
export function csvField(value: CellValue): string {
  const text = cellText(value);
  const guarded =
    !isNumericCell(value) && FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** One record, CRLF-terminated. */
export function csvLine(values: readonly CellValue[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}
