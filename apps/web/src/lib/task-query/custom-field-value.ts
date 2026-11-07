import { formatDateShort } from "@/lib/format";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How a stored custom field value reads in cells and group headers. */
export function customFieldValueLabel(
  type: string | undefined,
  value: string,
  t: Translate,
): string {
  if (!value) return "";
  if (type === "boolean") {
    if (value === "true") return t("tasks:customFieldValue.true");
    if (value === "false") return t("tasks:customFieldValue.false");
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    // A date without a time: read it as that day, not UTC midnight.
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return formatDateShort(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
  }
  return value;
}

/** A field's dropdown options; anything else stored there reads as none. */
export function customFieldOptions(options: unknown): string[] {
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}
