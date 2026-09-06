import type { EstimateTotals } from "../estimate/types";
import { listDays } from "../utils/calendar-date";
import { DEFAULT_TIMEZONE, localDateString } from "../utils/zoned-date";
import { progressPercent, type TaskGroup } from "./scope";

// Pure progress computations over a planning scope (a cycle's or a module's
// visible tasks: not archived, not in triage). Cancelled tasks are reported
// separately and never count toward progress (completed ÷ (total − cancelled)).
// Callers fetch the rows; nothing here touches the database.

export type GroupCounts = {
  total: number;
  backlog: number;
  unstarted: number;
  started: number;
  completed: number;
  cancelled: number;
};

export type BurnChartDay = {
  date: string;
  remaining: number | null;
  completed: number | null;
  ideal: number;
};

export type BurnChart = {
  scope: number;
  days: BurnChartDay[];
};

type Tally = {
  total: number;
  completed: number;
  cancelled: number;
  pending: number;
};

export type AssigneeBreakdownRow = Tally & {
  userId: string | null;
  name: string | null;
  image: string | null;
};

export type LabelBreakdownRow = Tally & {
  name: string | null;
  color: string | null;
};

export const BREAKDOWN_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const;

export type BreakdownPriority = (typeof BREAKDOWN_PRIORITIES)[number];

export type PriorityBreakdownRow = Tally & { priority: BreakdownPriority };

/** Everything a progress report computes. */
export type ProgressReport = {
  counts: GroupCounts;
  pending: number;
  progress: number;
  chart: BurnChart | null;
  assignees: AssigneeBreakdownRow[];
  labels: LabelBreakdownRow[];
  priorities: PriorityBreakdownRow[];
  /** Estimate totals over the scope; null when the caller supplied none. */
  estimates: EstimateTotals | null;
  /** The chart weighted by each task's estimate value (points mode). */
  estimateChart: BurnChart | null;
};

export type ScopeTask = {
  id: string;
  group: TaskGroup | null;
  priority: string;
  completedAt: Date | null;
  updatedAt: Date;
};

/** One assignee of a scope task (see task/assignees.ts). */
export type ScopeTaskAssignee = {
  id: string;
  name: string;
  image: string | null;
};

export type ScopeTaskLabel = {
  id: string;
  taskId: string;
  name: string;
  color: string;
  createdAt: Date;
};

export const EMPTY_COUNTS: GroupCounts = {
  total: 0,
  backlog: 0,
  unstarted: 0,
  started: 0,
  completed: 0,
  cancelled: 0,
};

export function countGroups(
  tasks: ReadonlyArray<Pick<ScopeTask, "group">>,
): GroupCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const task of tasks) {
    counts.total++;
    switch (task.group) {
      case "backlog":
      case "unstarted":
      case "started":
      case "completed":
      case "cancelled":
        counts[task.group]++;
        break;
      default:
        // Scope rows never carry triage or archived; count them as not started.
        counts.unstarted++;
    }
  }
  return counts;
}

/** Backlog + not started + started: the "unfinished tasks" number. */
export function pendingOf(counts: GroupCounts): number {
  return counts.backlog + counts.unstarted + counts.started;
}

export function progressOf(counts: GroupCounts): number {
  return progressPercent({
    completed: counts.completed,
    cancelled: counts.cancelled,
    visible: counts.total,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Burn-down and burn-up series from the tasks' completion timestamps. Scope
 * excludes cancelled tasks; a task counts as done from the UTC date it was
 * completed (its last update when the timestamp is missing). Days after
 * today have no actual values. No dates, no scope, or a range of more than
 * `maxDays` inclusive days means no chart.
 *
 * Each task weighs 1 by default. Points mode passes its estimate value
 * instead (0 without one), and every number is then a sum, rounded to 2
 * decimals.
 */
export function buildBurnChart<
  T extends Pick<ScopeTask, "group" | "completedAt" | "updatedAt">,
>({
  startDate,
  endDate,
  today,
  scopeTasks,
  maxDays,
  weight = () => 1,
  timezone = DEFAULT_TIMEZONE,
}: {
  startDate: string | null;
  endDate: string | null;
  today: string;
  scopeTasks: readonly T[];
  maxDays?: number;
  weight?: (task: T) => number;
  /** The workspace zone that turns completion times into days. */
  timezone?: string;
}): BurnChart | null {
  if (!startDate || !endDate) return null;

  const inScope = scopeTasks.filter((task) => task.group !== "cancelled");
  const scope = round2(inScope.reduce((sum, task) => sum + weight(task), 0));
  if (scope <= 0) return null;

  const days = listDays(startDate, endDate);
  const n = days.length;
  if (maxDays !== undefined && n > maxDays) return null;

  const completions = inScope
    .filter((task) => task.group === "completed")
    .map((task) => ({
      on: localDateString(task.completedAt ?? task.updatedAt, timezone),
      weight: weight(task),
    }));

  return {
    scope,
    days: days.map((date, i) => {
      const completed =
        date > today
          ? null
          : round2(
              completions.reduce(
                (sum, completion) =>
                  completion.on <= date ? sum + completion.weight : sum,
                0,
              ),
            );
      return {
        date,
        completed,
        remaining: completed === null ? null : round2(scope - completed),
        ideal: n === 1 ? scope : round2(scope * (1 - i / (n - 1))),
      };
    }),
  };
}

function emptyTally(): Tally {
  return { total: 0, completed: 0, cancelled: 0, pending: 0 };
}

function tally(target: Tally, group: TaskGroup | null) {
  target.total++;
  if (group === "completed") target.completed++;
  else if (group === "cancelled") target.cancelled++;
  else target.pending++;
}

function compareNames(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  return a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());
}

/** Name ascending (case-insensitive), unassigned last. */
export function sortAssigneeRows(
  rows: AssigneeBreakdownRow[],
): AssigneeBreakdownRow[] {
  return [...rows].sort((a, b) => {
    if (a.userId === null || b.userId === null) {
      return a.userId === b.userId ? 0 : a.userId === null ? 1 : -1;
    }
    return (
      compareNames(a.name ?? "", b.name ?? "") ||
      a.userId.localeCompare(b.userId)
    );
  });
}

/** Name ascending (case-insensitive), the no-label row last. */
export function sortLabelRows(rows: LabelBreakdownRow[]): LabelBreakdownRow[] {
  return [...rows].sort(
    (a, b) =>
      compareNames(a.name, b.name) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/**
 * One row per assignee (a task with k assignees counts in k rows) plus an
 * unassigned row for tasks with nobody. Totals elsewhere count distinct
 * tasks, never the sum of these rows.
 */
export function assigneeRows(
  tasks: readonly ScopeTask[],
  assignees: ReadonlyMap<string, readonly ScopeTaskAssignee[]>,
): AssigneeBreakdownRow[] {
  const rows = new Map<string | null, AssigneeBreakdownRow>();
  const count = (
    userId: string | null,
    person: ScopeTaskAssignee | null,
    group: TaskGroup | null,
  ) => {
    let row = rows.get(userId);
    if (!row) {
      row = {
        userId,
        name: person?.name ?? null,
        image: person?.image ?? null,
        ...emptyTally(),
      };
      rows.set(userId, row);
    }
    tally(row, group);
  };
  for (const task of tasks) {
    const people = assignees.get(task.id) ?? [];
    if (people.length === 0) count(null, null, task.group);
    for (const person of people) count(person.id, person, task.group);
  }
  return sortAssigneeRows([...rows.values()]);
}

/**
 * One row per label name over the tasks' label copies (a task with k labels
 * counts in k rows) plus a no-label row. The color is the workspace label's
 * when one has that name, otherwise the oldest task label's.
 */
export function labelRows(
  tasks: readonly ScopeTask[],
  labels: readonly ScopeTaskLabel[],
  workspaceColors: ReadonlyMap<string, string>,
): LabelBreakdownRow[] {
  const groupById = new Map(tasks.map((task) => [task.id, task.group]));
  const ordered = [...labels].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  const rows = new Map<string, LabelBreakdownRow>();
  const labelled = new Set<string>();
  for (const label of ordered) {
    if (!groupById.has(label.taskId)) continue;
    labelled.add(label.taskId);
    let row = rows.get(label.name);
    if (!row) {
      row = {
        name: label.name,
        color: workspaceColors.get(label.name) ?? label.color,
        ...emptyTally(),
      };
      rows.set(label.name, row);
    }
    tally(row, groupById.get(label.taskId) ?? null);
  }

  const result = [...rows.values()];
  const unlabelled = tasks.filter((task) => !labelled.has(task.id));
  if (unlabelled.length > 0) {
    const row: LabelBreakdownRow = { name: null, color: null, ...emptyTally() };
    for (const task of unlabelled) tally(row, task.group);
    result.push(row);
  }
  return sortLabelRows(result);
}

function toBreakdownPriority(priority: string): BreakdownPriority {
  return (BREAKDOWN_PRIORITIES as readonly string[]).includes(priority)
    ? (priority as BreakdownPriority)
    : "no-priority";
}

/** Always the five priorities in fixed order, zeros included. */
export function priorityRows(
  tasks: ReadonlyArray<Pick<ScopeTask, "priority" | "group">>,
): PriorityBreakdownRow[] {
  const rows = new Map<BreakdownPriority, PriorityBreakdownRow>(
    BREAKDOWN_PRIORITIES.map((priority) => [
      priority,
      { priority, ...emptyTally() },
    ]),
  );
  for (const task of tasks) {
    const row = rows.get(toBreakdownPriority(task.priority));
    if (row) tally(row, task.group);
  }
  return BREAKDOWN_PRIORITIES.map(
    (priority) => rows.get(priority) ?? { priority, ...emptyTally() },
  );
}

/**
 * The whole report. `estimateValues` maps task ids to their estimate value
 * for the points chart; without it, or with no estimated task in scope,
 * `estimateChart` is null.
 */
export function buildProgressReport({
  startDate,
  endDate,
  today,
  maxChartDays,
  tasks,
  assignees,
  labels,
  workspaceColors,
  estimates = null,
  estimateValues,
  timezone,
}: {
  startDate: string | null;
  endDate: string | null;
  today: string;
  timezone?: string;
  maxChartDays?: number;
  tasks: readonly ScopeTask[];
  /** Each scope task's assignees, in order; missing means none. */
  assignees: ReadonlyMap<string, readonly ScopeTaskAssignee[]>;
  labels: readonly ScopeTaskLabel[];
  workspaceColors: ReadonlyMap<string, string>;
  estimates?: EstimateTotals | null;
  estimateValues?: ReadonlyMap<string, number>;
}): ProgressReport {
  const counts = countGroups(tasks);
  const chartInput = {
    startDate,
    endDate,
    today,
    scopeTasks: tasks,
    maxDays: maxChartDays,
    timezone,
  };
  return {
    counts,
    pending: pendingOf(counts),
    progress: progressOf(counts),
    chart: buildBurnChart(chartInput),
    assignees: assigneeRows(tasks, assignees),
    labels: labelRows(tasks, labels, workspaceColors),
    priorities: priorityRows(tasks),
    estimates,
    estimateChart:
      estimateValues && estimateValues.size > 0
        ? buildBurnChart({
            ...chartInput,
            weight: (task) => estimateValues.get(task.id) ?? 0,
          })
        : null,
  };
}
