import { HTTPException } from "hono/http-exception";

// Pure assignee rules: input resolution and change planning. No database
// access, so the permission middleware and the controllers share them and
// unit tests cover them directly. Readers live in assignees.ts, writers in
// assignee-writes.ts.

export const MAX_TASK_ASSIGNEES = 20;

export const TOO_MANY_ASSIGNEES = `A task can have at most ${MAX_TASK_ASSIGNEES} assignees`;
export const ADD_AND_REMOVE_CONFLICT =
  "A user can't be added and removed in the same request";
export const NOTHING_TO_CHANGE = "Provide users to add or remove";

/**
 * Trims every id, drops blanks and keeps the first occurrence of duplicates.
 * More than MAX_TASK_ASSIGNEES left is a 400.
 */
export function normalizeAssigneeIds(
  ids: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const raw of ids ?? []) {
    const id = raw.trim();
    if (id) seen.add(id);
  }
  if (seen.size > MAX_TASK_ASSIGNEES) {
    throw new HTTPException(400, { message: TOO_MANY_ASSIGNEES });
  }
  return [...seen];
}

type AssigneeInput = {
  assigneeIds?: readonly string[] | null;
  userId?: string | null;
};

/**
 * The assignees of a new task (create and import): `assigneeIds` when sent
 * (even empty), else the single `userId`, else nobody.
 */
export function resolveCreateAssignees({
  assigneeIds,
  userId,
}: AssigneeInput): string[] {
  if (assigneeIds != null) return normalizeAssigneeIds(assigneeIds);
  const single = userId?.trim();
  return single ? [single] : [];
}

/**
 * The assignees a full replace (`PUT /task/{id}`) asks for, or null when it
 * keeps them. Echoing the current first assignee as `userId` keeps everyone,
 * so clients that send the task back unchanged never drop assignees.
 */
export function resolveFullUpdateAssignees({
  assigneeIds,
  userId,
  current,
}: AssigneeInput & { current: readonly string[] }): string[] | null {
  if (assigneeIds != null) return normalizeAssigneeIds(assigneeIds);
  const single = userId?.trim();
  if (!single) return [];
  if (single === current[0]) return null;
  return [single];
}

/** The legacy single route: one user replaces everyone; blank clears. */
export function resolveLegacyAssignee(
  userId: string | null | undefined,
): string[] {
  const single = userId?.trim();
  return single ? [single] : [];
}

/** Same people, whatever the order. */
export function sameAssigneeSet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * The add and remove lists of `PATCH /task/assignees/{id}`, normalized.
 * Both empty, or one user in both, is a 400.
 */
export function resolvePatchAssignees({
  add,
  remove,
}: {
  add?: readonly string[] | null;
  remove?: readonly string[] | null;
}): { add: string[]; remove: string[] } {
  const toAdd = normalizeAssigneeIds(add);
  const toRemove = normalizeAssigneeIds(remove);
  if (toAdd.length === 0 && toRemove.length === 0) {
    throw new HTTPException(400, { message: NOTHING_TO_CHANGE });
  }
  const removing = new Set(toRemove);
  if (toAdd.some((id) => removing.has(id))) {
    throw new HTTPException(400, { message: ADD_AND_REMOVE_CONFLICT });
  }
  return { add: toAdd, remove: toRemove };
}

/** Removals first, then additions appended in request order. */
export function patchTarget(
  current: readonly string[],
  { add, remove }: { add: readonly string[]; remove: readonly string[] },
): string[] {
  const removing = new Set(remove);
  return [...current.filter((id) => !removing.has(id)), ...add];
}

/** A current assignee row, already in assignee order. */
export type AssigneeSlot = { userId: string; position: number };

export type AssigneePlan = {
  /** New users, in target order. */
  added: string[];
  /** Users leaving, in their current order. */
  removed: string[];
  /** Where each added user goes. */
  insert: AssigneeSlot[];
  before: string[];
  after: string[];
  firstBefore: string | null;
  firstAfter: string | null;
  changed: boolean;
};

/**
 * Plans moving from the current rows (in assignee order) to `target`.
 * People who stay keep their positions, whatever the request order; new
 * people are appended after the highest current position (removed rows
 * included) in target order. Duplicates in `target` count once.
 */
export function planAssigneeChange(
  current: readonly AssigneeSlot[],
  target: readonly string[],
): AssigneePlan {
  const before = current.map((row) => row.userId);
  const staying = new Set(target);
  const present = new Set(before);
  const added = [...new Set(target)].filter((id) => !present.has(id));
  const removed = before.filter((id) => !staying.has(id));

  const highest = current.reduce((max, row) => Math.max(max, row.position), -1);
  const insert = added.map((userId, index) => ({
    userId,
    position: highest + 1 + index,
  }));
  const after = [...before.filter((id) => staying.has(id)), ...added];

  return {
    added,
    removed,
    insert,
    before,
    after,
    firstBefore: before[0] ?? null,
    firstAfter: after[0] ?? null,
    changed: added.length > 0 || removed.length > 0,
  };
}

/** An addition may not leave more than MAX_TASK_ASSIGNEES; removals always may. */
export function assertAssigneeLimit(plan: AssigneePlan) {
  if (plan.added.length > 0 && plan.after.length > MAX_TASK_ASSIGNEES) {
    throw new HTTPException(400, { message: TOO_MANY_ASSIGNEES });
  }
}
