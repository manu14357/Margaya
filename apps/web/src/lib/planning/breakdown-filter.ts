import { type ColumnGroup, columnGroupOf } from "@/lib/column-groups";
import { PLANNED_COLUMN_ID } from "@/lib/cycle/scope";
import type { BoardFilters } from "@/lib/task-query/planning-filters";

type ColumnLike = { slug: string; group?: string | null; isFinal?: boolean };

/** The status filter values of a column group; backlog includes planned. */
export function groupStatusValues(
  columns: readonly ColumnLike[],
  group: ColumnGroup,
): string[] {
  const slugs = columns
    .filter(
      (column) =>
        column.slug !== PLANNED_COLUMN_ID && columnGroupOf(column) === group,
    )
    .map((column) => column.slug);
  return group === "backlog" ? [...slugs, PLANNED_COLUMN_ID] : slugs;
}

function sameValues(a: readonly string[] | null, b: readonly string[]) {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

export type BreakdownFilterKey = "status" | "assignee" | "priority";

/** A breakdown row is active when the filter holds exactly its values. */
export function isBreakdownFilterActive(
  filters: BoardFilters,
  key: BreakdownFilterKey,
  values: readonly string[],
): boolean {
  return values.length > 0 && sameValues(filters[key], values);
}

/** Clicking a row sets the filter to its values, or clears it when active. */
export function nextBreakdownFilter(
  filters: BoardFilters,
  key: BreakdownFilterKey,
  values: readonly string[],
): string[] | null {
  if (values.length === 0) return filters[key];
  return isBreakdownFilterActive(filters, key, values) ? null : [...values];
}
