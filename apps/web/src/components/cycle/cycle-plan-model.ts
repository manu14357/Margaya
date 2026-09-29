import { columnGroupOf, isClosedGroup } from "@/lib/column-groups";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export type PlanTask = {
  task: Task;
  /** "WEB-12". */
  key: string;
  /** The task's board column (planned tasks sit in a synthetic one). */
  column: { slug: string; icon: string | null; group: string | null };
};

/** Pending moves the API has not confirmed yet: task id → in the cycle. */
export type PlanOverrides = ReadonlyMap<string, boolean>;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function rankOf(priority: string | null | undefined) {
  return PRIORITY_RANK[priority ?? ""] ?? 4;
}

/** Urgent first, then high, medium, low and none; ties by task number. */
export function byPriority(a: PlanTask, b: PlanTask) {
  return (
    rankOf(a.task.priority) - rankOf(b.task.priority) ||
    (a.task.number ?? 0) - (b.task.number ?? 0)
  );
}

/** Every unarchived task of the board, planned ones included. */
function planTasksOf(project: ProjectWithTasks): PlanTask[] {
  const key = (task: Task) => `${project.slug}-${task.number ?? ""}`;
  const planned = (project.plannedTasks ?? []).map((task) => ({
    task,
    key: key(task),
    column: { slug: "planned", icon: null, group: "backlog" },
  }));
  const inColumns = project.columns.flatMap((column) =>
    column.tasks.map((task) => ({
      task,
      key: key(task),
      column: {
        slug: column.slug,
        icon: column.icon,
        group: columnGroupOf(column),
      },
    })),
  );
  return [...planned, ...inColumns].filter((entry) => !entry.task.archivedAt);
}

/**
 * The planner's two lists. The cycle holds its tasks (with pending moves
 * applied); the backlog offers open tasks that are in no cycle, as the
 * "Add existing" picker does. Both are sorted by priority.
 */
export function splitPlan(
  project: ProjectWithTasks | null | undefined,
  cycleId: string,
  overrides: PlanOverrides,
): { backlog: PlanTask[]; cycle: PlanTask[] } {
  if (!project) return { backlog: [], cycle: [] };
  const backlog: PlanTask[] = [];
  const cycle: PlanTask[] = [];
  for (const entry of planTasksOf(project)) {
    const inCycle =
      overrides.get(entry.task.id) ?? entry.task.cycleId === cycleId;
    if (inCycle) cycle.push(entry);
    else if (!entry.task.cycleId && !isClosedGroup(entry.column.group)) {
      backlog.push(entry);
    } else if (overrides.get(entry.task.id) === false) {
      backlog.push(entry);
    }
  }
  return { backlog: backlog.sort(byPriority), cycle: cycle.sort(byPriority) };
}

/** Drops the overrides the board data now agrees with. */
export function settleOverrides(
  project: ProjectWithTasks | null | undefined,
  cycleId: string,
  overrides: PlanOverrides,
): Map<string, boolean> {
  const next = new Map(overrides);
  if (!project || overrides.size === 0) return next;
  for (const entry of planTasksOf(project)) {
    const wanted = overrides.get(entry.task.id);
    if (wanted === undefined) continue;
    if ((entry.task.cycleId === cycleId) === wanted) {
      next.delete(entry.task.id);
    }
  }
  return next;
}

/** Matches the key ("WEB-12") or the title, case-insensitively. */
export function searchPlan(tasks: readonly PlanTask[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tasks];
  return tasks.filter(
    (entry) =>
      entry.key.toLowerCase().includes(needle) ||
      entry.task.title.toLowerCase().includes(needle),
  );
}
