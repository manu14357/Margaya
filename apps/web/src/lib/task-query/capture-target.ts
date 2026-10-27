import {
  columnGroupOf,
  getEntryColumn,
  withoutTriage,
} from "@/lib/column-groups";
import type { TaskQueryMeta } from "@/types/task-query";
import type { GroupByKey } from "./model";
import { NONE_VALUE } from "./model";

// Where a task created from a group's quick add lands, so it shows up in
// that group: the group's value becomes the task's value (B4 §6.6). Groups
// whose value a new task can't take (creator, triage, planned) get no quick
// add, nor do groups outside one project on cross-project lists.

export type CaptureGrouping = { by: GroupByKey | null; key: string };

export type CaptureCapabilities = {
  /** cycle:update, to put the new task into the group's cycle. */
  updateCycles: boolean;
  /** module:update, to put the new task into the group's module. */
  updateModules: boolean;
  /** task:update, to give the new task the group's estimate. */
  updateTasks: boolean;
};

export type CaptureTarget = {
  projectId: string;
  /** The column slug: the group's, else the project's entry column. */
  status: string;
  statusName: string;
  priority?: string;
  /** The group's assignee; empty for "No assignee" (no project default). */
  assigneeIds?: string[];
  labels?: Array<{ name: string; color: string }>;
  cycleId?: string;
  moduleId?: string;
  estimatePointId?: string;
};

function projectOfGrouping(
  { by, key }: CaptureGrouping,
  meta: TaskQueryMeta,
): string | null {
  if (key === NONE_VALUE) return null;
  switch (by) {
    case "project":
      return key;
    case "cycle":
      return meta.cycles.find((cycle) => cycle.id === key)?.projectId ?? null;
    case "module":
      return (
        meta.modules.find((module) => module.id === key)?.projectId ?? null
      );
    case "estimate":
      return (
        meta.estimatePoints.find((point) => point.id === key)?.projectId ?? null
      );
    default:
      return null;
  }
}

/**
 * The quick-add target for a group (and sub-group), or null when a task
 * created there could not belong to it.
 */
export function captureTargetFor({
  groupings,
  meta,
  scopeProjectId,
  can,
}: {
  groupings: readonly CaptureGrouping[];
  meta: TaskQueryMeta;
  /** The list's own project; null on cross-project lists. */
  scopeProjectId: string | null;
  can: CaptureCapabilities;
}): CaptureTarget | null {
  let projectId = scopeProjectId;
  for (const grouping of groupings) {
    const owner = projectOfGrouping(grouping, meta);
    if (!owner) continue;
    if (projectId && projectId !== owner) return null;
    projectId = owner;
  }
  if (!projectId) return null;

  const columns = meta.columns.filter(
    (column) => column.projectId === projectId,
  );
  const target: Omit<CaptureTarget, "status" | "statusName"> & {
    column?: (typeof columns)[number];
  } = { projectId };

  for (const { by, key } of groupings) {
    if (!by || by === "project") continue;
    const none = key === NONE_VALUE;
    switch (by) {
      case "status": {
        const column = columns.find((candidate) => candidate.slug === key);
        if (!column || columnGroupOf(column) === "triage") return null;
        target.column = column;
        break;
      }
      case "group": {
        if (none || key === "triage") return null;
        const column = columns
          .filter((candidate) => columnGroupOf(candidate) === key)
          .sort((a, b) => a.position - b.position)[0];
        if (!column) return null;
        target.column = column;
        break;
      }
      case "priority":
        target.priority = none ? "no-priority" : key;
        break;
      case "assignee":
        target.assigneeIds = none ? [] : [key];
        break;
      case "label": {
        if (none) break;
        const label = meta.labels.find((candidate) => candidate.key === key);
        if (!label) return null;
        target.labels = [{ name: label.name, color: label.color }];
        break;
      }
      case "cycle":
        if (none) break;
        if (!can.updateCycles) return null;
        target.cycleId = key;
        break;
      case "module":
        if (none) break;
        if (!can.updateModules) return null;
        target.moduleId = key;
        break;
      case "estimate":
        if (none) break;
        if (!can.updateTasks) return null;
        target.estimatePointId = key;
        break;
      default:
        // The creator is always the person adding the task.
        return null;
    }
  }

  const { column: groupColumn, ...rest } = target;
  const column =
    groupColumn ?? getEntryColumn(columns) ?? withoutTriage(columns)[0];
  if (!column) return null;
  return { ...rest, status: column.slug, statusName: column.name };
}
