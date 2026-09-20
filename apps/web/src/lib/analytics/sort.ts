import { NONE_KEY, OTHER_KEY } from "./labels";

// Pure re-sorting for analytics results and tables. The API returns buckets
// in natural order; "Sort by value" and header clicks re-sort on the client.

type ValueBucket = { key: string; value: number };

/**
 * Largest value first, ties in their natural (incoming) order. `other` and
 * `none` stay last, in that order, so "Unassigned" never jumps to the top.
 */
export function sortBucketsByValue<T extends ValueBucket>(
  buckets: readonly T[],
): T[] {
  const rank = (key: string) =>
    key === NONE_KEY ? 2 : key === OTHER_KEY ? 1 : 0;
  return buckets
    .map((bucket, index) => ({ bucket, index }))
    .sort(
      (a, b) =>
        rank(a.bucket.key) - rank(b.bucket.key) ||
        b.bucket.value - a.bucket.value ||
        a.index - b.index,
    )
    .map(({ bucket }) => bucket);
}

export type SortDirection = "asc" | "desc";

export type TableSort = { columnId: string; direction: SortDirection } | null;

type SortableRow = { order: number; cells: Record<string, unknown> };

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Rows sorted by one column. Empty cells go last in both directions; ties
 * keep the natural order.
 */
export function sortTableRows<T extends SortableRow>(
  rows: readonly T[],
  sort: TableSort,
): T[] {
  if (!sort) return [...rows].sort((a, b) => a.order - b.order);
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a.cells[sort.columnId];
    const right = b.cells[sort.columnId];
    const leftEmpty = left === null || left === undefined || left === "";
    const rightEmpty = right === null || right === undefined || right === "";
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (leftEmpty) return a.order - b.order;
    return sign * compareValues(left, right) || a.order - b.order;
  });
}

/** Header clicks cycle: descending for numbers first, then the other way, then off. */
export function nextSort(
  current: TableSort,
  columnId: string,
  numeric: boolean,
): TableSort {
  const first: SortDirection = numeric ? "desc" : "asc";
  if (!current || current.columnId !== columnId) {
    return { columnId, direction: first };
  }
  if (current.direction === first) {
    return { columnId, direction: first === "asc" ? "desc" : "asc" };
  }
  return null;
}
