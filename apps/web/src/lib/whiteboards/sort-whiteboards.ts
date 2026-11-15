import type {
  WhiteboardSort,
  WhiteboardSortField,
  WhiteboardSummary,
} from "@/types/whiteboard";

export const WHITEBOARD_SORT_FIELDS: readonly WhiteboardSortField[] = [
  "updatedAt",
  "createdAt",
  "title",
];

export const DEFAULT_WHITEBOARD_SORT: WhiteboardSort = {
  field: "updatedAt",
  direction: "desc",
};

export function isWhiteboardSort(value: unknown): value is WhiteboardSort {
  if (typeof value !== "object" || value === null) return false;
  const { field, direction } = value as Record<string, unknown>;
  return (
    (WHITEBOARD_SORT_FIELDS as readonly unknown[]).includes(field) &&
    (direction === "asc" || direction === "desc")
  );
}

/** A sorted copy; untitled boards sort by the label they show. */
export function sortWhiteboards<
  T extends Pick<WhiteboardSummary, "title" | "createdAt" | "updatedAt" | "id">,
>(boards: readonly T[], sort: WhiteboardSort, untitled: string): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return [...boards].sort((a, b) => {
    let order: number;
    if (sort.field === "title") {
      order = collator.compare(
        a.title.trim() || untitled,
        b.title.trim() || untitled,
      );
    } else {
      order = Date.parse(a[sort.field]) - Date.parse(b[sort.field]);
    }
    // Ties keep a stable, id-based order so cards don't jump on refetch.
    return order === 0 ? a.id.localeCompare(b.id) : sign * order;
  });
}
