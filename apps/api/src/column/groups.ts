import { HTTPException } from "hono/http-exception";

// Every column belongs to exactly one group. `triage` is reserved for intake:
// the column API never creates, edits or deletes triage columns.
export const COLUMN_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
  "triage",
] as const;

export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export const CREATABLE_COLUMN_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const satisfies readonly ColumnGroup[];

export type CreatableColumnGroup = (typeof CREATABLE_COLUMN_GROUPS)[number];

export const OPEN_COLUMN_GROUPS = [
  "backlog",
  "unstarted",
  "started",
] as const satisfies readonly ColumnGroup[];

export const CLOSED_COLUMN_GROUPS = [
  "completed",
  "cancelled",
] as const satisfies readonly ColumnGroup[];

export const DEFAULT_COLUMN_GROUP: CreatableColumnGroup = "unstarted";

// Fixed order for aggregations, pickers and group-by. It never forces the
// board order, which stays user-defined through `column.position`.
export const COLUMN_GROUP_RANK: Record<ColumnGroup, number> = {
  triage: -1,
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export function isColumnGroup(value: unknown): value is ColumnGroup {
  return (
    typeof value === "string" &&
    (COLUMN_GROUPS as readonly string[]).includes(value)
  );
}

export function isClosedGroup(group: string | null | undefined): boolean {
  return group === "completed" || group === "cancelled";
}

export function isCompletedGroup(group: string | null | undefined): boolean {
  return group === "completed";
}

export function isOpenGroup(group: string | null | undefined): boolean {
  return group === "backlog" || group === "unstarted" || group === "started";
}

export const TRIAGE_RESERVED_MESSAGE =
  "The triage group is reserved for intake";
export const TRIAGE_MANAGED_MESSAGE = "Triage columns are managed by intake";
export const IS_FINAL_MISMATCH_MESSAGE = "isFinal must match the column group";

type ColumnGroupInput = {
  group?: ColumnGroup;
  isFinal?: boolean;
};

type ResolvedColumnGroup = {
  group: CreatableColumnGroup;
  isFinal: boolean;
};

function assertCreatableGroup(
  group: ColumnGroup,
): asserts group is CreatableColumnGroup {
  if (group === "triage") {
    throw new HTTPException(400, { message: TRIAGE_RESERVED_MESSAGE });
  }
}

/**
 * Applies the create matrix: an explicit group wins and sets `isFinal`;
 * `isFinal: true` alone means completed; nothing means not started. An
 * `isFinal` that contradicts the group is rejected.
 */
export function resolveColumnGroupForCreate({
  group,
  isFinal,
}: ColumnGroupInput): ResolvedColumnGroup {
  if (group !== undefined) {
    assertCreatableGroup(group);
    const closed = isClosedGroup(group);
    if (isFinal !== undefined && isFinal !== closed) {
      throw new HTTPException(400, { message: IS_FINAL_MISMATCH_MESSAGE });
    }
    return { group, isFinal: closed };
  }

  if (isFinal === true) {
    return { group: "completed", isFinal: true };
  }

  return { group: DEFAULT_COLUMN_GROUP, isFinal: false };
}

/**
 * Applies the update matrix against the column's current group. `isFinal`
 * alone keeps a group that already agrees with it; otherwise `true` turns the
 * column into completed and `false` into started, since a column that stops
 * being final most likely holds work in flight.
 */
export function resolveColumnGroupForUpdate(
  current: CreatableColumnGroup,
  { group, isFinal }: ColumnGroupInput,
): ResolvedColumnGroup {
  if (group !== undefined) {
    return resolveColumnGroupForCreate({ group, isFinal });
  }

  if (isFinal === undefined) {
    return { group: current, isFinal: isClosedGroup(current) };
  }

  if (isFinal === isClosedGroup(current)) {
    return { group: current, isFinal };
  }

  return isFinal
    ? { group: "completed", isFinal: true }
    : { group: "started", isFinal: false };
}
