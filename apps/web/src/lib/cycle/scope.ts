import { columnGroupOf, isClosedGroup } from "@/lib/column-groups";
import type { ProjectWithTasks } from "@/types/project";

/** The id and slug of the synthetic column holding a cycle's planned tasks. */
export const PLANNED_COLUMN_ID = "planned";

/**
 * The board, scoped to one cycle: every column keeps only the cycle's tasks.
 * Board columns never include planned tasks, so when the cycle has any, a
 * synthetic backlog column is prepended; dragging into or out of it sets the
 * status to `planned` or to the target column's slug, both valid statuses.
 * Archived tasks are dropped.
 */
export function scopeProjectToCycle(
  project: ProjectWithTasks,
  cycleId: string,
  backlogLabel: string,
): ProjectWithTasks {
  return scopeProjectToTasks(
    project,
    (task) => task.cycleId === cycleId,
    backlogLabel,
  );
}

/**
 * The board scoped to the tasks `belongs` accepts, with the same synthetic
 * backlog column as a cycle's board. Modules scope by task id.
 */
export function scopeProjectToTasks(
  project: ProjectWithTasks,
  belongs: (task: ProjectWithTasks["plannedTasks"][number]) => boolean,
  backlogLabel: string,
): ProjectWithTasks {
  const inScope = <T extends ProjectWithTasks["plannedTasks"][number]>(
    tasks: T[],
  ) => tasks.filter(belongs);

  // After a drag the board writes this scoped project back to the project
  // store, so the input may already hold the synthetic column; its tasks are
  // then the freshest planned list.
  const synthetic = project.columns?.find(
    (column) => column.id === PLANNED_COLUMN_ID,
  );
  const columns = (project.columns ?? [])
    .filter((column) => column !== synthetic)
    .map((column) => ({ ...column, tasks: inScope(column.tasks) }));
  const planned = inScope(synthetic?.tasks ?? project.plannedTasks ?? []);

  if (planned.length > 0) {
    columns.unshift({
      id: PLANNED_COLUMN_ID,
      slug: PLANNED_COLUMN_ID,
      name: backlogLabel,
      icon: null,
      group: "backlog",
      isFinal: false,
      position: -1,
      tasks: planned,
    });
  }

  return { ...project, columns, archivedTasks: [], plannedTasks: planned };
}

/** Every task of the cycle on the scoped board, planned ones included. */
export function cycleTasksOf(project: ProjectWithTasks | null | undefined) {
  return project?.columns.flatMap((column) => column.tasks) ?? [];
}

const HIGH_PRIORITIES = ["urgent", "high"];

/**
 * The cycle's open urgent and high priority tasks, urgent first, then by
 * board order; planned tasks count as open.
 */
export function highPriorityCycleTasks(
  project: ProjectWithTasks | null | undefined,
  cycleId: string,
  limit = 10,
) {
  if (!project) return [];
  const open = [
    ...(project.plannedTasks ?? []),
    ...project.columns
      .filter((column) => !isClosedGroup(columnGroupOf(column)))
      .flatMap((column) => column.tasks),
  ];
  return open
    .filter(
      (task) =>
        task.cycleId === cycleId &&
        HIGH_PRIORITIES.includes(task.priority ?? ""),
    )
    .map((task, index) => ({ task, index }))
    .sort(
      (a, b) =>
        HIGH_PRIORITIES.indexOf(a.task.priority ?? "") -
          HIGH_PRIORITIES.indexOf(b.task.priority ?? "") || a.index - b.index,
    )
    .slice(0, limit)
    .map(({ task }) => task);
}
