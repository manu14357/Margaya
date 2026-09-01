import type { ViewTask } from "../views-shared/data";

export type GanttZoom = "week" | "month" | "quarter";

export type GanttViewState = {
  tasks: ViewTask[];
  zoom: GanttZoom;
  /** Whether the blocking relation (tokens → release) is drawn. */
  linked: boolean;
};

export type GanttViewAction =
  | { type: "zoom"; zoom: GanttZoom }
  | { type: "link" }
  | { type: "resize"; id: string; end: number };

/** The first day of the window: Monday, October 12. */
export const RANGE_START = 12;
/** Days drawn; the widest zoom still fills the stage. */
export const RANGE_DAYS = 42;
/** Day column widths in px: the app's 6rem, 2.75rem and 1rem. */
export const DAY_WIDTH: Record<GanttZoom, number> = {
  week: 96,
  month: 44,
  quarter: 16,
};
export const ROW_HEIGHT = 52;
/** The blocking relation the scene draws. */
export const RELATION = { source: "tokens", target: "release" } as const;
/** The rows, top to bottom. */
export const GANTT_ROWS = [
  "tokens",
  "latency",
  "a11y",
  "release",
  "search",
  "invoices",
] as const;

export function ganttViewReducer(
  state: GanttViewState,
  action: GanttViewAction,
): GanttViewState {
  switch (action.type) {
    case "zoom":
      return { ...state, zoom: action.zoom };
    case "link":
      return { ...state, linked: true };
    case "resize":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? { ...task, end: Math.max(task.start, action.end) }
            : task,
        ),
      };
  }
}

/** A blocker that ends after the blocked task starts breaks the relation. */
export function isConflict(source: ViewTask, target: ViewTask): boolean {
  return source.end > target.start;
}

const GAP = 8;

/**
 * The connector from the blocker's end to the blocked task's start, as the
 * app draws it: out to the right, down, and in from the left; when the
 * start is behind the end it detours between the two rows.
 */
export function dependencyPath(
  source: { right: number; centerY: number },
  target: { left: number; centerY: number },
): string {
  const exitX = source.right + GAP;
  const entryX = target.left - GAP;
  const { centerY: y1 } = source;
  const { centerY: y2 } = target;
  if (entryX >= exitX) {
    return `M ${source.right} ${y1} H ${exitX} V ${y2} H ${target.left}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${source.right} ${y1} H ${exitX} V ${midY} H ${entryX} V ${y2} H ${target.left}`;
}

/** A bar's horizontal box in the timeline, inset 4px like the app's. */
export function barBox(task: ViewTask, dayWidth: number) {
  return {
    left: (task.start - RANGE_START) * dayWidth + 4,
    right: (task.end - RANGE_START + 1) * dayWidth - 4,
  };
}
