import type { UpdateCustomFieldRequest } from "@/fetchers/custom-field/update-custom-field";

// Turns the edit dialog's draft into an update. Each option row remembers the
// text it started with, so changing a row's text is a rename rather than a
// removal plus an addition, which would leave its tasks on the old text.

export type OptionRow = {
  key: string;
  /** The saved option this row started as; null for a new one. */
  original: string | null;
  value: string;
};

export function rowsFromOptions(options: readonly string[]): OptionRow[] {
  return options.map((option, index) => ({
    key: `saved-${index}`,
    original: option,
    value: option,
  }));
}

export function hasDuplicateOptions(rows: readonly OptionRow[]): boolean {
  const values = rows.map((row) => row.value.trim()).filter(Boolean);
  return new Set(values).size !== values.length;
}

/** Rows filled in enough to save: no blanks, no repeats, at least one. */
export function optionsAreValid(rows: readonly OptionRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => row.value.trim().length > 0) &&
    !hasDuplicateOptions(rows)
  );
}

export function buildFieldEdit(
  rows: readonly OptionRow[],
): Pick<UpdateCustomFieldRequest, "options" | "renamedOptions"> {
  const renamedOptions = rows.flatMap((row) =>
    row.original !== null && row.original !== row.value.trim()
      ? [{ from: row.original, to: row.value.trim() }]
      : [],
  );
  return {
    options: rows.map((row) => row.value.trim()),
    ...(renamedOptions.length > 0 ? { renamedOptions } : {}),
  };
}

/** The default after the draft's renames; "" when it was removed. */
export function defaultAfterEdit(
  rows: readonly OptionRow[],
  current: string,
): string {
  if (!current) return "";
  const row = rows.find(
    (candidate) =>
      candidate.original === current || candidate.value.trim() === current,
  );
  return row ? row.value.trim() : "";
}
