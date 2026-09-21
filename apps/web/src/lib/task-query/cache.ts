import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { TaskQueryResult, TaskQueryRow } from "@/types/task-query";

// Query keys and cache helpers for task query results. Every key starts
// with "task-query", then the workspace, then the scope: one project's id,
// or "workspace" for workspace-wide lists.

export const TASK_QUERY_ROOT = "task-query";
export const WORKSPACE_SCOPE_KEY = "workspace";

export const taskQueryKeys = {
  all: () => [TASK_QUERY_ROOT] as const,
  workspace: (workspaceId: string) => [TASK_QUERY_ROOT, workspaceId] as const,
  scope: (workspaceId: string, scopeKey: string) =>
    [TASK_QUERY_ROOT, workspaceId, scopeKey] as const,
  request: (
    workspaceId: string,
    scopeKey: string,
    mode: "rows" | "ids" | "counts",
    request: unknown,
  ) => [TASK_QUERY_ROOT, workspaceId, scopeKey, mode, request] as const,
};

export const myWorkQueryKeys = {
  all: () => ["my-work"] as const,
  workspace: (workspaceId: string) => ["my-work", workspaceId] as const,
};

/** The scope part of a key: the single project, else the workspace. */
export function scopeKeyOf(projectIds: readonly string[] | undefined): string {
  return projectIds?.length === 1
    ? (projectIds[0] ?? WORKSPACE_SCOPE_KEY)
    : WORKSPACE_SCOPE_KEY;
}

function isTaskQueryKey(key: QueryKey): boolean {
  return key[0] === TASK_QUERY_ROOT;
}

/**
 * Refreshes task query results: those of one project (and every workspace
 * list, which may show it), or all of them. Only mounted queries refetch.
 */
export function invalidateTaskQueries(
  queryClient: QueryClient,
  projectId?: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!isTaskQueryKey(key)) return false;
        if (!projectId) return true;
        return key[2] === projectId || key[2] === WORKSPACE_SCOPE_KEY;
      },
    }),
    queryClient.invalidateQueries({ queryKey: myWorkQueryKeys.all() }),
  ]).then(() => undefined);
}

function hasTasks(data: unknown): data is Pick<TaskQueryResult, "tasks"> {
  return Boolean(
    data &&
      typeof data === "object" &&
      "tasks" in data &&
      (data as { tasks: unknown }).tasks &&
      typeof (data as { tasks: unknown }).tasks === "object",
  );
}

/**
 * Patches one task in every cached query result (an optimistic cell edit).
 * Returns a function that restores what was there.
 */
export function patchTaskInQueryCache(
  queryClient: QueryClient,
  taskId: string,
  patch: Partial<TaskQueryRow>,
): () => void {
  const snapshots: Array<[QueryKey, unknown]> = [];
  for (const query of queryClient.getQueryCache().findAll({
    predicate: (candidate) => isTaskQueryKey(candidate.queryKey),
  })) {
    const data = query.state.data;
    if (!hasTasks(data)) continue;
    const row = data.tasks[taskId];
    if (!row) continue;
    snapshots.push([query.queryKey, data]);
    queryClient.setQueryData(query.queryKey, {
      ...data,
      tasks: { ...data.tasks, [taskId]: { ...row, ...patch } },
    });
  }
  return () => {
    for (const [key, data] of snapshots) queryClient.setQueryData(key, data);
  };
}

const PATCHABLE_FIELDS = [
  "title",
  "status",
  "priority",
  "startDate",
  "dueDate",
] as const;

/**
 * The row fields a task mutation's variables set, for an optimistic patch:
 * only plain task edits (an object with a task id and the edited fields).
 */
export function taskPatchFromVariables(
  variables: unknown,
): { taskId: string; patch: Partial<TaskQueryRow> } | null {
  if (!variables || typeof variables !== "object") return null;
  const candidate = variables as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  const patch: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (!(field in candidate)) continue;
    const value = candidate[field];
    if (field === "title" || field === "status" || field === "priority") {
      if (typeof value === "string" && value) patch[field] = value;
    } else if (value === null || typeof value === "string") {
      patch[field] = value;
    }
  }
  // An archive alias is not a column; leave it to the refetch.
  if (patch.status === "archived") delete patch.status;
  return Object.keys(patch).length > 0
    ? { taskId: candidate.id, patch: patch as Partial<TaskQueryRow> }
    : null;
}
