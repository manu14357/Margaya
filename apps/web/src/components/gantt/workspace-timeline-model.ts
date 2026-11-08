import { differenceInCalendarDays } from "date-fns";
import { parseTaskDate } from "@/components/gantt/timeline";
import { countConditions } from "@/lib/task-query/filter-tree";
import type { MergedTaskQueryResult } from "@/lib/task-query/merge";
import { type FilterNode, isFilterGroup } from "@/lib/task-query/model";
import type { TaskQueryRow } from "@/types/task-query";

// The cross-project timeline's pure parts: which tasks to ask for and how the
// rows the task query returns become one section of bars per project.

/** The API's limits on a filter tree (task-query/schema.ts). */
const MAX_FILTER_DEPTH = 3;
const MAX_FILTER_CONDITIONS = 50;

const DATED: FilterNode = {
  op: "or",
  children: [
    { key: "startDate", operator: "notEmpty" },
    { key: "dueDate", operator: "notEmpty" },
  ],
};

const groupDepth = (node: FilterNode): number =>
  isFilterGroup(node) ? 1 + Math.max(0, ...node.children.map(groupDepth)) : 0;

/**
 * The view's filters, narrowed to tasks with a date so undated tasks don't
 * use up a project's page. A tree already at the API's limits stays as it is;
 * `timelineSections` drops undated rows either way.
 */
export function datedOnlyFilter(root: FilterNode | null): FilterNode {
  if (!root) return DATED;
  const atLimit =
    groupDepth(root) >= MAX_FILTER_DEPTH ||
    countConditions(root) + 2 > MAX_FILTER_CONDITIONS;
  return atLimit ? root : { op: "and", children: [DATED, root] };
}

export type TimelineRow = TaskQueryRow & {
  scheduleStart: Date;
  scheduleEnd: Date;
};

export type TimelineSection = {
  projectId: string;
  name: string;
  icon: string | null;
  /** Every dated task of the project, loaded or not. */
  count: number;
  rows: TimelineRow[];
  hasMore: boolean;
};

/** A row's span: one date stands for both, and swapped dates are put right. */
function scheduled(row: TaskQueryRow): TimelineRow | null {
  const start = parseTaskDate(row.startDate) ?? parseTaskDate(row.dueDate);
  const end = parseTaskDate(row.dueDate) ?? parseTaskDate(row.startDate);
  if (!start || !end) return null;
  return {
    ...row,
    scheduleStart: start <= end ? start : end,
    scheduleEnd: end >= start ? end : start,
  };
}

/** Sections in the response's order, each project's rows by start date. */
export function timelineSections(
  data: MergedTaskQueryResult,
): TimelineSection[] {
  return data.groups.flatMap((group) => {
    const project = data.meta.projects.find((entry) => entry.id === group.key);
    if (!project) return [];
    const rows = group.taskIds
      .flatMap((id) => {
        const row = data.tasks[id];
        const span = row ? scheduled(row) : null;
        return span ? [span] : [];
      })
      .sort(
        (a, b) =>
          a.scheduleStart.getTime() - b.scheduleStart.getTime() ||
          a.scheduleEnd.getTime() - b.scheduleEnd.getTime(),
      );
    if (rows.length === 0 && !group.nextCursor) return [];
    return [
      {
        projectId: project.id,
        name: project.name,
        icon: project.icon,
        count: group.count,
        rows,
        hasMore: Boolean(group.nextCursor),
      },
    ];
  });
}

/** The grid lines of a bar in the visible days, or null when it is outside. */
export function barColumns(
  row: Pick<TimelineRow, "scheduleStart" | "scheduleEnd">,
  rangeStart: Date,
  dayCount: number,
): { start: number; end: number } | null {
  const first = differenceInCalendarDays(row.scheduleStart, rangeStart);
  const last = differenceInCalendarDays(row.scheduleEnd, rangeStart);
  if (dayCount <= 0 || last < 0 || first >= dayCount) return null;
  return {
    start: Math.max(first, 0) + 1,
    end: Math.min(last, dayCount - 1) + 2,
  };
}
