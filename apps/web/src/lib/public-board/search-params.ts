import type {
  PublicBoard,
  PublicLayout,
  PublicSort,
  PublicTaskListQuery,
} from "@/types/public-board";

// The public board's URL state (B12 §1.3): layout, filters, search, sort
// and the open peek. Parsing is lenient: unknown or disallowed values are
// dropped, never an error page.

export const PUBLIC_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const;

const MAX_TASK_NUMBER = 2 ** 31 - 1;
const MAX_SEARCH_LENGTH = 100;
const MAX_LIST_LENGTH = 2000;

/** The raw search params as the route keeps them. */
export type BoardSearch = {
  layout?: string;
  status?: string;
  priority?: string;
  label?: string;
  q?: string;
  sort?: string;
  task?: number;
};

/** The board view after checking the search against the board. */
export type BoardView = {
  layout: PublicLayout;
  status: string[];
  priority: string[];
  label: string[];
  q: string;
  sort: PublicSort;
  task: number | null;
};

type BoardFacts = Pick<PublicBoard, "board" | "columns" | "labels" | "sorts">;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function taskNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TASK_NUMBER
    ? parsed
    : undefined;
}

/** The route's `validateSearch`: keeps well-formed strings and a task number. */
export function parseBoardSearch(raw: Record<string, unknown>): BoardSearch {
  const search: BoardSearch = {
    layout: text(raw.layout, 20),
    status: text(raw.status, MAX_LIST_LENGTH),
    priority: text(raw.priority, 200),
    label: text(raw.label, MAX_LIST_LENGTH),
    q: text(raw.q, MAX_SEARCH_LENGTH),
    sort: text(raw.sort, 20),
    task: taskNumber(raw.task),
  };
  for (const key of Object.keys(search) as Array<keyof BoardSearch>) {
    if (search[key] === undefined) delete search[key];
  }
  return search;
}

export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

/** The search checked against what this board allows. */
export function resolveBoardView(
  search: BoardSearch,
  board: BoardFacts,
): BoardView {
  const layouts = board.board.layouts;
  const layout = layouts.includes(search.layout as PublicLayout)
    ? (search.layout as PublicLayout)
    : board.board.defaultLayout;
  const columns = new Set(board.columns.map((column) => column.slug));
  const labels = new Set(board.labels.map((label) => label.name));
  const sort = board.sorts.includes(search.sort as PublicSort)
    ? (search.sort as PublicSort)
    : "manual";
  return {
    layout,
    status: splitList(search.status).filter((slug) => columns.has(slug)),
    priority: splitList(search.priority).filter((priority) =>
      (PUBLIC_PRIORITIES as readonly string[]).includes(priority),
    ),
    label: splitList(search.label).filter((name) => labels.has(name)),
    q: search.q ?? "",
    sort,
    task: search.task ?? null,
  };
}

/** The view written back to the URL, leaving out defaults and empties. */
export function serializeBoardView(
  view: BoardView,
  defaultLayout: PublicLayout,
): BoardSearch {
  const search: BoardSearch = {};
  if (view.layout !== defaultLayout) search.layout = view.layout;
  if (view.status.length > 0) search.status = view.status.join(",");
  if (view.priority.length > 0) search.priority = view.priority.join(",");
  if (view.label.length > 0) search.label = view.label.join(",");
  if (view.q.trim()) search.q = view.q.trim().slice(0, MAX_SEARCH_LENGTH);
  if (view.sort !== "manual") search.sort = view.sort;
  if (view.task !== null) search.task = view.task;
  return search;
}

/** The task list request (Q2) for a view; the peek and layout don't change it. */
export function toTaskListQuery(view: BoardView): PublicTaskListQuery {
  const query: PublicTaskListQuery = {};
  if (view.status.length > 0) query.status = view.status.join(",");
  if (view.priority.length > 0) query.priority = view.priority.join(",");
  if (view.label.length > 0) query.label = view.label.join(",");
  if (view.q.trim()) query.q = view.q.trim();
  if (view.sort !== "manual") query.sort = view.sort;
  return query;
}

export function activeFilterCount(view: BoardView): number {
  return view.status.length + view.priority.length + view.label.length;
}

export function hasActiveFilters(view: BoardView): boolean {
  return activeFilterCount(view) > 0 || view.q.trim().length > 0;
}

/** Adds or removes one value of a list filter. */
export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}
