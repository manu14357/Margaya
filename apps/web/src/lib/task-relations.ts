import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CalendarClock,
  Copy,
  Flag,
  Link2,
  OctagonAlert,
} from "lucide-react";

// Relation vocabulary, mirroring the API's task-relation types. One row is
// stored per relation (`blocks`, `related`, `duplicate`, `start_before`,
// `finish_before`, plus `subtask` for parents), and each task reads it from
// its own side: the display key. Every display key is also an input name the
// API accepts, so a key picked in this task's picker is sent as is.

/** Display keys in group order. */
export const RELATION_DISPLAY_KEYS = [
  "blocked_by",
  "blocking",
  "related",
  "duplicate",
  "start_before",
  "start_after",
  "finish_before",
  "finish_after",
] as const;

export type RelationDisplayKey = (typeof RELATION_DISPLAY_KEYS)[number];

/** Every name POST /task-relation accepts. */
export type RelationInputName = RelationDisplayKey | "subtask" | "blocks";

export const DEFAULT_RELATION_KEY: RelationDisplayKey = "related";

type RelationMeta = {
  icon: LucideIcon;
  /** Group heading, e.g. "Blocked by". */
  groupKey: string;
  /** The same in lower case, for sentences ("removed the blocked by relation"). */
  typeKey: string;
};

export const RELATION_META: Record<RelationDisplayKey, RelationMeta> = {
  blocked_by: {
    icon: OctagonAlert,
    groupKey: "tasks:relations.groups.blocked_by",
    typeKey: "tasks:relations.types.blocked_by",
  },
  blocking: {
    icon: Ban,
    groupKey: "tasks:relations.groups.blocking",
    typeKey: "tasks:relations.types.blocking",
  },
  related: {
    icon: Link2,
    groupKey: "tasks:relations.groups.related",
    typeKey: "tasks:relations.types.related",
  },
  duplicate: {
    icon: Copy,
    groupKey: "tasks:relations.groups.duplicate",
    typeKey: "tasks:relations.types.duplicate",
  },
  start_before: {
    icon: CalendarClock,
    groupKey: "tasks:relations.groups.start_before",
    typeKey: "tasks:relations.types.start_before",
  },
  start_after: {
    icon: CalendarClock,
    groupKey: "tasks:relations.groups.start_after",
    typeKey: "tasks:relations.types.start_after",
  },
  finish_before: {
    icon: Flag,
    groupKey: "tasks:relations.groups.finish_before",
    typeKey: "tasks:relations.types.finish_before",
  },
  finish_after: {
    icon: Flag,
    groupKey: "tasks:relations.groups.finish_after",
    typeKey: "tasks:relations.types.finish_after",
  },
};

export function isRelationDisplayKey(
  value: unknown,
): value is RelationDisplayKey {
  return (
    typeof value === "string" &&
    (RELATION_DISPLAY_KEYS as readonly string[]).includes(value)
  );
}

/**
 * How a stored relation reads from one of its tasks. Symmetric types (and
 * unknown legacy values) read the same from both sides.
 */
export function relationPerspective(
  relationType: string,
  viewerIsSource: boolean,
): string {
  switch (relationType) {
    case "blocks":
      return viewerIsSource ? "blocking" : "blocked_by";
    case "start_before":
      return viewerIsSource ? "start_before" : "start_after";
    case "finish_before":
      return viewerIsSource ? "finish_before" : "finish_after";
    default:
      return relationType;
  }
}

export type RelationLike = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  createdAt?: string | Date | null;
};

export type RelationRow<T> = RelationLike & {
  sourceTask: T | null;
  targetTask: T | null;
};

export type RelationGroup<R, T> = {
  key: RelationDisplayKey;
  items: Array<{ relation: R; task: T }>;
};

/**
 * The task's non-subtask relations grouped by display key, in group order;
 * empty groups are left out, and so are rows whose other task is not visible.
 */
export function groupRelations<R extends RelationRow<unknown>>(
  relations: readonly R[],
  taskId: string,
): RelationGroup<R, NonNullable<R["sourceTask"]>>[] {
  type Other = NonNullable<R["sourceTask"]>;
  const buckets = new Map<
    RelationDisplayKey,
    RelationGroup<R, Other>["items"]
  >();
  for (const relation of relations) {
    if (relation.relationType === "subtask") continue;
    const viewerIsSource = relation.sourceTaskId === taskId;
    if (!viewerIsSource && relation.targetTaskId !== taskId) continue;
    const task = (
      viewerIsSource ? relation.targetTask : relation.sourceTask
    ) as Other | null;
    if (!task) continue;
    const key = relationPerspective(relation.relationType, viewerIsSource);
    if (!isRelationDisplayKey(key)) continue;
    const items = buckets.get(key) ?? [];
    items.push({ relation, task });
    buckets.set(key, items);
  }
  return RELATION_DISPLAY_KEYS.flatMap((key) => {
    const items = buckets.get(key);
    return items?.length ? [{ key, items }] : [];
  });
}

/** Tasks sharing a non-subtask relation with the task, in either direction. */
export function relatedTaskIds(
  relations: readonly RelationLike[],
  taskId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const relation of relations) {
    if (relation.relationType === "subtask") continue;
    if (relation.sourceTaskId === taskId) ids.add(relation.targetTaskId);
    else if (relation.targetTaskId === taskId) ids.add(relation.sourceTaskId);
  }
  return ids;
}

function createdAtMs(relation: RelationLike): number {
  if (!relation.createdAt) return 0;
  const time = new Date(relation.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** The task's parent rows, oldest first (legacy data can hold several). */
export function parentRows<R extends RelationLike>(
  relations: readonly R[],
  taskId: string,
): R[] {
  return relations
    .filter(
      (relation) =>
        relation.relationType === "subtask" && relation.targetTaskId === taskId,
    )
    .sort(
      (a, b) =>
        createdAtMs(a) - createdAtMs(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** The parent a task shows: the oldest parent row wins. */
export function oldestParent<R extends RelationLike>(
  relations: readonly R[],
  taskId: string,
): R | null {
  return parentRows(relations, taskId)[0] ?? null;
}

/** Ids of the task's direct sub-tasks. */
export function subtaskIds(
  relations: readonly RelationLike[],
  taskId: string,
): Set<string> {
  return new Set(
    relations
      .filter(
        (relation) =>
          relation.relationType === "subtask" &&
          relation.sourceTaskId === taskId,
      )
      .map((relation) => relation.targetTaskId),
  );
}

type Identified = { id: string };

/** Relation picker candidates: not the task, not already related to it. */
export function relationCandidates<T extends Identified>(
  allTasks: readonly T[],
  relations: readonly RelationLike[],
  taskId: string,
): T[] {
  const related = relatedTaskIds(relations, taskId);
  return allTasks.filter((task) => task.id !== taskId && !related.has(task.id));
}

/**
 * Parent picker candidates: not the task, not its current parent (listed on
 * its own) and not its direct sub-tasks. Deeper descendants are refused by
 * the server.
 */
export function parentCandidates<T extends Identified>(
  allTasks: readonly T[],
  relations: readonly RelationLike[],
  taskId: string,
): T[] {
  const excluded = subtaskIds(relations, taskId);
  for (const row of parentRows(relations, taskId)) {
    excluded.add(row.sourceTaskId);
  }
  return allTasks.filter(
    (task) => task.id !== taskId && !excluded.has(task.id),
  );
}

/**
 * The task's ancestors known from cached relation lists (`relationsOf`
 * returns undefined for a task whose relations are not cached). The server
 * makes the final check.
 */
export function ancestorIds(
  taskId: string,
  relationsOf: (id: string) => readonly RelationLike[] | undefined,
): Set<string> {
  const ancestors = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const row of relationsOf(current) ?? []) {
      if (row.relationType !== "subtask" || row.targetTaskId !== current) {
        continue;
      }
      const parent = row.sourceTaskId;
      if (parent === taskId || ancestors.has(parent)) continue;
      ancestors.add(parent);
      queue.push(parent);
    }
  }
  return ancestors;
}

/** "Add existing" candidates: not the task, its sub-tasks or its ancestors. */
export function subtaskCandidates<T extends Identified>(
  allTasks: readonly T[],
  relations: readonly RelationLike[],
  taskId: string,
  ancestors: ReadonlySet<string>,
): T[] {
  const children = subtaskIds(relations, taskId);
  return allTasks.filter(
    (task) =>
      task.id !== taskId && !children.has(task.id) && !ancestors.has(task.id),
  );
}

type BoardTask = { id: string; number?: number | null };

type BoardLike<T> = {
  columns?: ReadonlyArray<{
    position?: number | null;
    tasks?: readonly T[] | null;
  }> | null;
  plannedTasks?: readonly T[] | null;
};

/**
 * The tasks of a board cache (["tasks", projectId]) the pickers offer: board
 * columns by position, then planned tasks, each by number. Archived tasks
 * are left out.
 */
export function boardTaskList<T extends BoardTask>(
  board: BoardLike<T> | null | undefined,
): T[] {
  if (!board) return [];
  const byNumber = (a: T, b: T) =>
    (a.number ?? Number.MAX_SAFE_INTEGER) -
    (b.number ?? Number.MAX_SAFE_INTEGER);
  const columns = (board.columns ?? [])
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (a.column.position ?? a.index) - (b.column.position ?? b.index) ||
        a.index - b.index,
    );
  const seen = new Set<string>();
  const result: T[] = [];
  const add = (tasks: readonly T[] | null | undefined) => {
    for (const task of [...(tasks ?? [])].sort(byNumber)) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      result.push(task);
    }
  };
  for (const { column } of columns) add(column.tasks);
  add(board.plannedTasks);
  return result;
}

/** Case-insensitive match on a task's key and title. */
export function matchesTaskQuery(
  query: string,
  key: string,
  title: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${key} ${title}`.toLowerCase().includes(needle);
}
