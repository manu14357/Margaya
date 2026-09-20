import { scopeProjectToTasks } from "@/lib/cycle/scope";
import type { ProjectWithTasks } from "@/types/project";

const NO_TASKS: ReadonlySet<string> = new Set();

/**
 * The board scoped to one module's tasks, with the cycle board's synthetic
 * backlog column for planned tasks. Membership comes from the task map, so
 * archived tasks (never on the board) simply drop out.
 */
export function scopeProjectToModule(
  project: ProjectWithTasks,
  taskIds: ReadonlySet<string> | undefined,
  backlogLabel: string,
): ProjectWithTasks {
  const ids = taskIds ?? NO_TASKS;
  return scopeProjectToTasks(project, (task) => ids.has(task.id), backlogLabel);
}
