import type { QueryClient } from "@tanstack/react-query";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import {
  type AssigneeFields,
  assigneesOfTask,
  peopleFromMembers,
  type TaskAssignee,
  withAssignees,
} from "@/lib/task-assignees";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export type TaskAssigneesTarget = {
  taskId: string;
  projectId: string;
  /** Names new assignees from the cached member list. */
  workspaceId: string;
};

type IdsUpdater = (ids: readonly string[]) => readonly string[];

function updateTask(
  task: Task,
  taskId: string,
  update: IdsUpdater,
  people: readonly TaskAssignee[],
): Task {
  if (task.id !== taskId) return task;
  return withAssignees(task, update(assigneesOfTask(task)), people);
}

export function updateTaskAssigneesInProject(
  project: ProjectWithTasks,
  taskId: string,
  update: IdsUpdater,
  people: readonly TaskAssignee[] = [],
): ProjectWithTasks {
  const apply = (task: Task) => updateTask(task, taskId, update, people);
  return {
    ...project,
    columns: project.columns.map((column) => ({
      ...column,
      tasks: column.tasks.map(apply),
    })),
    plannedTasks: project.plannedTasks.map(apply),
    archivedTasks: project.archivedTasks.map(apply),
  };
}

function findBoardTask(project: ProjectWithTasks | undefined, taskId: string) {
  if (!project) return undefined;
  for (const column of project.columns) {
    const task = column.tasks.find((candidate) => candidate.id === taskId);
    if (task) return task;
  }
  return [...project.plannedTasks, ...project.archivedTasks].find(
    (task) => task.id === taskId,
  );
}

/** The task's assignees as cached: its detail first, else its board. */
export function readCachedAssigneeIds(
  queryClient: QueryClient,
  { taskId, projectId }: TaskAssigneesTarget,
): readonly string[] | undefined {
  const detail = queryClient.getQueryData<AssigneeFields>(["task", taskId]);
  if (detail) return assigneesOfTask(detail);
  const task = findBoardTask(
    queryClient.getQueryData<ProjectWithTasks>(["tasks", projectId]),
    taskId,
  );
  return task ? assigneesOfTask(task) : undefined;
}

/** Applies `update` to every cached copy of the task: detail and board. */
export function syncTaskAssigneesInCaches(
  queryClient: QueryClient,
  { taskId, projectId, workspaceId }: TaskAssigneesTarget,
  update: IdsUpdater,
) {
  const people =
    peopleFromMembers(
      queryClient.getQueryData(["active-workspace-users", workspaceId]),
    ) ?? [];
  queryClient.setQueryData<AssigneeFields>(["task", taskId], (task) =>
    task ? withAssignees(task, update(assigneesOfTask(task)), people) : task,
  );
  queryClient.setQueryData<ProjectWithTasks>(["tasks", projectId], (project) =>
    project
      ? updateTaskAssigneesInProject(project, taskId, update, people)
      : project,
  );
}

/** Stops refetches that would overwrite an optimistic change. */
export async function cancelTaskQueries(
  queryClient: QueryClient,
  { taskId, projectId }: TaskAssigneesTarget,
) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["task", taskId], exact: true }),
    queryClient.cancelQueries({ queryKey: ["tasks", projectId], exact: true }),
  ]);
}

/** Everything an assignee change can show up in. */
export function invalidateAssigneeQueries(
  queryClient: QueryClient,
  { taskId, projectId }: TaskAssigneesTarget,
) {
  for (const queryKey of [
    ["task", taskId],
    ["tasks", projectId],
    ["activities", taskId],
    ["task-relations"],
    ["notifications"],
    // Being assigned subscribes the new assignee.
    ["task-subscription", taskId],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  // Risk radars flag unowned work and group overdue work by assignee.
  invalidateDeliveryQueries(queryClient, projectId);
}
