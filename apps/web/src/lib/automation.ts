// Pure rules of the "Scheduled automations" settings (B11 §1.7).

import { columnGroupOf } from "@/lib/column-groups";

export const AUTOMATION_MONTH_OPTIONS = Array.from(
  { length: 12 },
  (_, index) => index + 1,
);

export const DEFAULT_AUTOMATION_MONTHS = 3;

export type RuleSetting = { enabled: boolean; months: number };

/**
 * A change takes more tasks than before (turning a rule on, or fewer
 * months): those ask for confirmation when tasks already match.
 */
export function isBroaderChange(
  current: RuleSetting,
  next: RuleSetting,
): boolean {
  if (!next.enabled) return false;
  if (!current.enabled) return true;
  return next.months < current.months;
}

type CancelColumn = {
  id: string;
  slug: string;
  position?: number | null;
  group?: string | null;
  isFinal?: boolean | null;
};

/** The project's columns in the Cancelled group, by position. */
export function cancelledColumns<T extends CancelColumn>(
  columns: readonly T[],
): T[] {
  return columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => columnGroupOf(column) === "cancelled")
    .sort(
      (a, b) =>
        (a.column.position ?? a.index) - (b.column.position ?? b.index) ||
        a.index - b.index,
    )
    .map(({ column }) => column);
}

/** The i18n key and options of a rule's preview line. */
export function previewLine(
  preview: { count: number; capped: boolean } | undefined,
): { key: string; options?: Record<string, unknown> } {
  if (!preview) return { key: "settings:projectAutomations.preview.loading" };
  if (preview.capped) {
    return { key: "settings:projectAutomations.preview.capped" };
  }
  if (preview.count === 0) {
    return { key: "settings:projectAutomations.preview.none" };
  }
  return {
    key: "settings:projectAutomations.preview.count",
    options: { count: preview.count },
  };
}
