import { assigneeGroupKeys } from "@/lib/task-assignees";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import type { GroupByKey } from "./model";
import { NONE_VALUE } from "./model";

// What dropping a card from one group into another changes (B4 §6.6).
// Grouping by group, project, creator or estimate is not draggable.

export type GroupMoveAction =
  | { kind: "status"; status: string }
  | { kind: "priority"; priority: string }
  | { kind: "assignee"; remove: string | null; add: string | null }
  | { kind: "label"; removeLabelId: string | null; addLabelId: string | null }
  | { kind: "cycle"; cycleId: string | null }
  | { kind: "module"; remove: string | null; add: string | null };

export function isDraggableGrouping(
  groupBy: GroupByKey | null,
  singleProject: boolean,
): boolean {
  switch (groupBy) {
    case "status":
      return singleProject;
    case "priority":
    case "assignee":
    case "label":
    case "cycle":
    case "module":
      return true;
    default:
      return false;
  }
}

function labelIdOf(meta: TaskQueryMeta, key: string): string | null {
  return (
    meta.labels.find((label) => label.key === key)?.workspaceLabelId ?? null
  );
}

/** The change for a move, or null when the move isn't possible. */
export function planGroupMove(
  groupBy: GroupByKey | null,
  from: string,
  to: string,
  meta: TaskQueryMeta,
): GroupMoveAction | null {
  if (from === to) return null;
  switch (groupBy) {
    case "status":
      return to === NONE_VALUE ? null : { kind: "status", status: to };
    case "priority":
      return { kind: "priority", priority: to };
    case "assignee":
      return {
        kind: "assignee",
        remove: from === NONE_VALUE ? null : from,
        add: to === NONE_VALUE ? null : to,
      };
    case "label": {
      // Labels move by name through their workspace label.
      const removeLabelId = from === NONE_VALUE ? null : labelIdOf(meta, from);
      const addLabelId = to === NONE_VALUE ? null : labelIdOf(meta, to);
      if (from !== NONE_VALUE && !removeLabelId) return null;
      if (to !== NONE_VALUE && !addLabelId) return null;
      return { kind: "label", removeLabelId, addLabelId };
    }
    case "cycle":
      return { kind: "cycle", cycleId: to === NONE_VALUE ? null : to };
    case "module":
      return {
        kind: "module",
        remove: from === NONE_VALUE ? null : from,
        add: to === NONE_VALUE ? null : to,
      };
    default:
      return null;
  }
}

/**
 * The groups a row sits in after a move, for the optimistic board. Moving
 * to "none" on a many-valued key clears every value (assignees).
 */
export function groupsAfterMove(
  groupBy: GroupByKey | null,
  row: TaskQueryRow,
  current: readonly string[],
  from: string,
  to: string,
): string[] {
  if (groupBy === "assignee") {
    if (to === NONE_VALUE) return [NONE_VALUE];
    const ids = (row.assigneeIds ?? []).filter((id) => id !== from);
    if (!ids.includes(to)) ids.push(to);
    return assigneeGroupKeys({ assigneeIds: ids });
  }
  if (groupBy === "label" || groupBy === "module") {
    const next = current.filter((key) => key !== from && key !== NONE_VALUE);
    if (to !== NONE_VALUE && !next.includes(to)) next.push(to);
    return next.length > 0 ? next : [NONE_VALUE];
  }
  return [to];
}
