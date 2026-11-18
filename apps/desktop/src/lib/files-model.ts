import type { FileEntry } from "./files-api";

// Pure helpers for the Files window: sorting, filtering and formatting.

export type SortKey = "name" | "modified" | "type" | "size";
export type SortDirection = "asc" | "desc";
export type Sort = { key: SortKey; direction: SortDirection };
export type ViewMode = "list" | "grid";

export const DEFAULT_SORT: Sort = { key: "name", direction: "asc" };

/** Lower-case extension without the dot, or "". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareNames(a: FileEntry, b: FileEntry) {
  return collator.compare(a.name, b.name);
}

/** Folders first, then files, each ordered by `sort`; ties go by name. */
export function sortEntries(entries: FileEntry[], sort: Sort): FileEntry[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const by = (a: FileEntry, b: FileEntry): number => {
    switch (sort.key) {
      case "modified":
        return (a.modified ?? 0) - (b.modified ?? 0);
      case "size":
        return (a.size ?? 0) - (b.size ?? 0);
      case "type":
        return collator.compare(extensionOf(a.name), extensionOf(b.name));
      default:
        return 0;
    }
  };
  return [...entries].sort((a, b) => {
    const folderA = a.kind === "folder" ? 0 : 1;
    const folderB = b.kind === "folder" ? 0 : 1;
    if (folderA !== folderB) return folderA - folderB;
    const primary = by(a, b);
    if (primary !== 0) return primary * sign;
    return compareNames(a, b) * (sort.key === "name" ? sign : 1);
  });
}

/** Entries whose name contains `query`, in any case; hidden ones only on request. */
export function filterEntries(
  entries: FileEntry[],
  query: string,
  showHidden: boolean,
): FileEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (showHidden || !entry.hidden) &&
      (needle === "" || entry.name.toLocaleLowerCase().includes(needle)),
  );
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1.4 MB, 820 KB, 12 B, in the page's locale. */
export function formatSize(bytes: number | null, locale?: string): string {
  if (bytes === null || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}

/** A short date and time in the page's locale. */
export function formatDate(ms: number | null, locale?: string): string {
  if (ms === null) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Audio and video stream from the core instead of being read whole. */
const STREAMED = new Set([
  "mp4",
  "m4v",
  "webm",
  "mov",
  "ogv",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "m4a",
  "aac",
  "flac",
]);

export function isStreamed(name: string): boolean {
  return STREAMED.has(extensionOf(name));
}

/** Columns a grid of `width` px fits, at `cell` px per item. */
export function gridColumns(width: number, cell: number): number {
  return Math.max(1, Math.floor(width / cell));
}

/**
 * The rows to render for a scrolled list: [first, last) with some overscan.
 * A zero height (not laid out yet, or a test) renders a first screenful.
 */
export function visibleRange(
  scrollTop: number,
  height: number,
  rowHeight: number,
  rows: number,
  overscan = 6,
): [number, number] {
  const shown = height > 0 ? Math.ceil(height / rowHeight) : 40;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(rows, first + shown + overscan * 2);
  return [first, last];
}

/** The index the arrow keys move to, in a list or a grid of `columns`. */
export function moveSelection(
  index: number,
  key: string,
  count: number,
  columns: number,
): number {
  if (count === 0) return -1;
  if (index < 0) return 0;
  const step = (delta: number) =>
    Math.min(count - 1, Math.max(0, index + delta));
  switch (key) {
    case "ArrowDown":
      return step(columns);
    case "ArrowUp":
      return step(-columns);
    case "ArrowRight":
      return columns > 1 ? step(1) : index;
    case "ArrowLeft":
      return columns > 1 ? step(-1) : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return step(columns * 10);
    case "PageUp":
      return step(-columns * 10);
    default:
      return index;
  }
}
