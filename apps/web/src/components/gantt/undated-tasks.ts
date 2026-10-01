import { parseTaskDate } from "./timeline";

type SearchableTask = {
  title: string;
  number: number | null;
  status: string;
};

/** The timeline's own search: title, task key or status. */
export function matchesGanttSearch(
  task: SearchableTask,
  query: string,
  projectSlug: string | undefined,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    task.title.toLowerCase().includes(needle) ||
    `${projectSlug ?? ""}-${task.number ?? ""}`
      .toLowerCase()
      .includes(needle) ||
    task.status.toLowerCase().includes(needle)
  );
}

/**
 * Tasks the filters kept that cannot be drawn: neither date is set (or both
 * are unreadable). They are listed apart so they can be scheduled.
 */
export function selectUndatedTasks<
  TTask extends SearchableTask & {
    startDate: string | null;
    dueDate: string | null;
  },
>(tasks: readonly TTask[], query: string, projectSlug?: string): TTask[] {
  return tasks.filter(
    (task) =>
      !parseTaskDate(task.startDate) &&
      !parseTaskDate(task.dueDate) &&
      matchesGanttSearch(task, query, projectSlug),
  );
}
