import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

// Classic mode (B4 K9): the full-load board keeps its cache, drag and drop
// and realtime; the engine only says which ids match the filters.

type TasksHolder = Pick<ProjectWithTasks, "columns"> &
  Partial<Pick<ProjectWithTasks, "plannedTasks" | "archivedTasks">>;

/** Keeps only the tasks whose ids matched; null ids keep everything. */
export function filterProjectByIds<T extends TasksHolder>(
  project: T,
  ids: ReadonlySet<string> | null,
  keep: (task: Task) => boolean = () => true,
): T {
  const matches = (task: Task) => (ids ? ids.has(task.id) : true) && keep(task);
  return {
    ...project,
    columns: project.columns.map((column) => ({
      ...column,
      tasks: column.tasks.filter(matches),
    })),
    ...(project.plannedTasks
      ? { plannedTasks: project.plannedTasks.filter(matches) }
      : {}),
    ...(project.archivedTasks
      ? { archivedTasks: project.archivedTasks.filter(matches) }
      : {}),
  };
}

/**
 * The board's text search (title, description, key), which stays in the
 * browser and runs after the engine's id filter.
 */
export function matchesTextQuery(
  task: Task,
  query: string | undefined,
  projectSlug: string | undefined,
  descriptionMatches?: ReadonlySet<string>,
): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  const title = task.title?.toLowerCase() ?? "";
  const description = task.description?.toLowerCase() ?? "";
  const number = task.number?.toString() ?? "";
  const key =
    number && projectSlug ? `${projectSlug}-${number}`.toLowerCase() : "";
  const shortKey = number ? `#${number}` : "";
  return (
    Boolean(descriptionMatches?.has(task.id)) ||
    title.includes(needle) ||
    description.includes(needle) ||
    number.includes(needle) ||
    key.startsWith(needle) ||
    shortKey.startsWith(needle)
  );
}
