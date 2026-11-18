import type { QueryClient } from "@tanstack/react-query";
import { createBatchedRefresh } from "@/lib/project-realtime";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

// The board cache (`["tasks", projectId]`) holds a whole project's tasks,
// loaded in many pages. Edits made in this tab patch it in place and ask for
// one batched reload instead of each invalidating (and restarting) the load.

export const boardQueryKey = (projectId: string) =>
  ["tasks", projectId] as const;

/** The board fields an edit can set and the server echoes back. */
const BOARD_TASK_FIELDS = [
  "title",
  "description",
  "descriptionDeferred",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "isMilestone",
  "position",
  "archivedAt",
  "estimatePointId",
] as const;

type BoardTaskField = (typeof BOARD_TASK_FIELDS)[number];
export type BoardTaskPatch = Partial<Pick<Task, BoardTaskField>>;

const LEGACY_ARCHIVED_STATUS = "archived";
const PLANNED_STATUS = "planned";

/** The board fields of a task-shaped value, such as an update's response. */
export function boardFieldsOf(value: unknown): BoardTaskPatch {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of BOARD_TASK_FIELDS) {
    if (field in source && source[field] !== undefined) {
      patch[field] = source[field];
    }
  }
  // An archive alias is not a column; archivedAt says it.
  if (patch.status === LEGACY_ARCHIVED_STATUS) delete patch.status;
  return patch as BoardTaskPatch;
}

type Bucket =
  | { kind: "column"; index: number }
  | { kind: "planned" }
  | {
      kind: "archived";
    };

function bucketOf(board: ProjectWithTasks, task: Task): Bucket | null {
  if (task.archivedAt) return { kind: "archived" };
  if (task.status === PLANNED_STATUS) return { kind: "planned" };
  const index = (board.columns ?? []).findIndex(
    (column) => column.id === task.status,
  );
  return index >= 0 ? { kind: "column", index } : null;
}

function tasksOf(board: ProjectWithTasks, bucket: Bucket): Task[] {
  if (bucket.kind === "planned") return board.plannedTasks ?? [];
  if (bucket.kind === "archived") return board.archivedTasks ?? [];
  return board.columns[bucket.index]?.tasks ?? [];
}

function withTasks(
  board: ProjectWithTasks,
  bucket: Bucket,
  tasks: Task[],
): ProjectWithTasks {
  if (bucket.kind === "planned") return { ...board, plannedTasks: tasks };
  if (bucket.kind === "archived") return { ...board, archivedTasks: tasks };
  return {
    ...board,
    columns: board.columns.map((column, index) =>
      index === bucket.index ? { ...column, tasks } : column,
    ),
  };
}

function sameBucket(left: Bucket, right: Bucket) {
  return (
    left.kind === right.kind &&
    (left.kind !== "column" ||
      left.index === (right as { index: number }).index)
  );
}

/** Board order: position, then id, as the API sorts; no position goes last. */
function compareTasks(left: Task, right: Task) {
  const a = left.position ?? Number.POSITIVE_INFINITY;
  const b = right.position ?? Number.POSITIVE_INFINITY;
  if (a !== b) return a < b ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function insertInOrder(tasks: Task[], task: Task): Task[] {
  const index = tasks.findIndex((other) => compareTasks(task, other) < 0);
  return index < 0
    ? [...tasks, task]
    : [...tasks.slice(0, index), task, ...tasks.slice(index)];
}

function findTask(board: ProjectWithTasks, taskId: string) {
  // Older and test caches may lack a bucket.
  for (const [index, column] of (board.columns ?? []).entries()) {
    const task = column.tasks?.find((candidate) => candidate.id === taskId);
    if (task) return { task, bucket: { kind: "column", index } as Bucket };
  }
  const planned = board.plannedTasks?.find((task) => task.id === taskId);
  if (planned) return { task: planned, bucket: { kind: "planned" } as Bucket };
  const archived = board.archivedTasks?.find((task) => task.id === taskId);
  if (archived) {
    return { task: archived, bucket: { kind: "archived" } as Bucket };
  }
  return null;
}

/**
 * A copy of the board with one task's fields replaced. The task moves to the
 * bucket its status and archive state put it in, in board order; a status
 * with no column on this board keeps it where it is until the next reload.
 * Unchanged buckets keep their identity, so their cards do not re-render.
 */
export function patchBoardTask(
  board: ProjectWithTasks,
  taskId: string,
  patch: BoardTaskPatch,
): ProjectWithTasks {
  const found = findTask(board, taskId);
  if (!found) return board;
  const changed = (Object.keys(patch) as BoardTaskField[]).some(
    (field) => found.task[field] !== patch[field],
  );
  if (!changed) return board;
  const next: Task = { ...found.task, ...patch };
  const target = bucketOf(board, next) ?? found.bucket;
  const source = tasksOf(board, found.bucket);
  if (sameBucket(target, found.bucket)) {
    const replaced = source.map((task) => (task.id === taskId ? next : task));
    return withTasks(
      board,
      target,
      next.position !== found.task.position
        ? [...replaced].sort(compareTasks)
        : replaced,
    );
  }
  const removed = withTasks(
    board,
    found.bucket,
    source.filter((task) => task.id !== taskId),
  );
  return withTasks(
    removed,
    target,
    insertInOrder(tasksOf(removed, target), next),
  );
}

// Edits made in this tab, kept until a board load that started after they
// were saved has replaced the cache: a load already running when an edit was
// made can still return the old values, and this tab gets no realtime echo
// of its own changes to correct them.
type LocalEdit = {
  taskId: string;
  patch: BoardTaskPatch;
  /** When the server confirmed it; unset while the request is pending. */
  savedAt?: number;
};

const localEdits = new Map<string, Set<LocalEdit>>();
const LOCAL_EDIT_TTL_MS = 10 * 60_000;

/**
 * Reapplies this tab's edits that a board load starting at `startedAt` may
 * not include, and forgets those it does. Used by the board query.
 */
export function withLocalBoardEdits<B extends ProjectWithTasks>(
  projectId: string,
  board: B,
  startedAt: number,
): B {
  const edits = localEdits.get(projectId);
  if (!edits) return board;
  let result: ProjectWithTasks = board;
  for (const edit of edits) {
    if (edit.savedAt !== undefined && edit.savedAt < startedAt) {
      edits.delete(edit);
      continue;
    }
    result = patchBoardTask(result, edit.taskId, edit.patch);
  }
  if (edits.size === 0) localEdits.delete(projectId);
  return result as B;
}

function setBoard(
  queryClient: QueryClient,
  projectId: string,
  update: (board: ProjectWithTasks) => ProjectWithTasks,
) {
  queryClient.setQueryData<ProjectWithTasks>(
    boardQueryKey(projectId),
    (board) => (board ? update(board) : board),
  );
}

export type BoardEdit = {
  /** The server saved it; its copy of the task, when given, wins. */
  saved: (serverTask?: unknown) => void;
  /** The request failed: the fields this edit changed are put back. */
  failed: () => void;
};

/**
 * Shows an edit to one task on the cached board at once (optimistic), keeps
 * it over loads that started before it was saved, and asks for one batched
 * reload once it settles: the server may have changed more than the edit
 * (positions, automations), and this tab gets no echo of it.
 */
export function startBoardEdit(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
  patch: BoardTaskPatch,
): BoardEdit {
  const cleanPatch = boardFieldsOf(patch);
  const cached = queryClient.getQueryData<ProjectWithTasks>(
    boardQueryKey(projectId),
  );
  const previous = cached ? findTask(cached, taskId)?.task : undefined;
  const edit: LocalEdit = { taskId, patch: cleanPatch };
  if (projectId) {
    const edits = localEdits.get(projectId) ?? new Set<LocalEdit>();
    // Saved edits of a board that is not reloading are only pruned here; no
    // load runs anywhere near this long.
    const stale = Date.now() - LOCAL_EDIT_TTL_MS;
    for (const old of edits) {
      if (old.savedAt !== undefined && old.savedAt < stale) edits.delete(old);
    }
    edits.add(edit);
    localEdits.set(projectId, edits);
    setBoard(queryClient, projectId, (board) =>
      patchBoardTask(board, taskId, cleanPatch),
    );
  }
  return {
    saved: (serverTask) => {
      if (!projectId) return;
      edit.patch = { ...edit.patch, ...boardFieldsOf(serverTask) };
      edit.savedAt = Date.now();
      setBoard(queryClient, projectId, (board) =>
        patchBoardTask(board, taskId, edit.patch),
      );
      scheduleBoardRefresh(queryClient, projectId);
    },
    failed: () => {
      if (!projectId) return;
      localEdits.get(projectId)?.delete(edit);
      if (previous) {
        const restore: Record<string, unknown> = {};
        for (const field of Object.keys(cleanPatch) as BoardTaskField[]) {
          restore[field] = previous[field];
        }
        setBoard(queryClient, projectId, (board) =>
          patchBoardTask(board, taskId, restore as BoardTaskPatch),
        );
      }
      scheduleBoardRefresh(queryClient, projectId);
    },
  };
}

let boardRefresh: ReturnType<typeof createBatchedRefresh> | null = null;

function boardRefresher() {
  if (!boardRefresh) {
    boardRefresh = createBatchedRefresh();
    // The batcher holds refreshes while the tab is hidden.
    const refresher = boardRefresh;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresher.wake();
    });
  }
  return boardRefresh;
}

/**
 * Reloads a project's board after this tab changed it, batched: a burst of
 * edits (a drop that moves many cards, bulk edits) causes at most one reload
 * at a time, and one more for what arrived while it ran.
 */
export function scheduleBoardRefresh(
  queryClient: QueryClient,
  projectId: string,
) {
  if (!projectId) return;
  boardRefresher().schedule(`board:${projectId}`, () =>
    queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  );
}

/** For tests: forgets local edits and pending refreshes. */
export function resetBoardCacheState() {
  localEdits.clear();
  boardRefresh?.dispose();
  boardRefresh = null;
}
