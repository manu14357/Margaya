// One cell value as CSV and XLSX see it, so both formats agree on how a
// value reads. JSON keeps the structured values instead.

export type CellValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly unknown[]
  | Record<string, unknown>;

/** ISO 8601 in UTC with a trailing `Z`. */
export function isoDate(value: Date): string {
  return value.toISOString();
}

function isStringArray(value: readonly unknown[]): value is readonly string[] {
  return value.every((item) => typeof item === "string");
}

/**
 * The text of a cell: empty for nothing, numbers with `.` and no grouping,
 * dates as ISO text, string lists joined with ", ", everything else as
 * compact JSON. An empty list is an empty cell.
 */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return isoDate(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return isStringArray(value) ? value.join(", ") : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** True for values written as a number (never prefixed, numeric in XLSX). */
export function isNumericCell(value: CellValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
