import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskDraftTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { liveTaskCondition } from "../../task/scope";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import { type DraftValues, visibleDraftValues } from "../normalize";

export type DraftRow = typeof taskDraftTable.$inferSelect;

export const DRAFT_NOT_FOUND = "Draft not found";

export function ownDrafts(userId: string, workspaceId: string) {
  return and(
    eq(taskDraftTable.createdBy, userId),
    eq(taskDraftTable.workspaceId, workspaceId),
  );
}

export function draftValuesOf(
  row: Omit<DraftRow, "description"> & {
    description?: string;
  },
): DraftValues {
  return {
    projectId: row.projectId,
    title: row.title,
    description: row.description ?? "",
    status: row.status,
    priority: row.priority,
    assigneeIds: row.assigneeIds ?? [],
    labels: row.labels ?? [],
    startDate: row.startDate,
    dueDate: row.dueDate,
    customFieldValues: row.customFieldValues ?? [],
    cycleId: row.cycleId,
    moduleIds: row.moduleIds ?? [],
    estimatePointId: row.estimatePointId,
    parentTaskId: row.parentTaskId,
  };
}

export type DraftProjectSummary = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  archived: boolean;
};

/** The chips of the drafts' projects, in one query. */
export async function loadDraftProjects(
  projectIds: readonly (string | null)[],
): Promise<Map<string, DraftProjectSummary>> {
  const ids = [...new Set(projectIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      archivedAt: projectTable.archivedAt,
    })
    .from(projectTable)
    .where(inArray(projectTable.id, ids));
  return new Map(
    rows.map(({ archivedAt, ...project }) => [
      project.id,
      { ...project, archived: archivedAt !== null },
    ]),
  );
}

export type DraftParentSummary = { id: string; key: string; title: string };

/**
 * The drafts' parents that are still live tasks of the draft's project, in
 * one query. A parent that moved or was trashed shows as none.
 */
export async function loadDraftParents(
  rows: readonly { projectId: string | null; parentTaskId: string | null }[],
): Promise<Map<string, DraftParentSummary & { projectId: string }>> {
  const ids = [
    ...new Set(
      rows.map((row) => row.parentTaskId).filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      projectId: taskTable.projectId,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(and(inArray(taskTable.id, ids), liveTaskCondition));
  return new Map(
    found.map((task) => [
      task.id,
      {
        id: task.id,
        key: formatTaskKey(task.slug, task.number),
        title: task.title,
        projectId: task.projectId,
      },
    ]),
  );
}

export type DraftLookups = {
  projects: Map<string, DraftProjectSummary>;
  parents: Map<string, DraftParentSummary & { projectId: string }>;
};

export async function loadDraftLookups(
  rows: readonly { projectId: string | null; parentTaskId: string | null }[],
): Promise<DraftLookups> {
  const [projects, parents] = await Promise.all([
    loadDraftProjects(rows.map((row) => row.projectId)),
    loadDraftParents(rows),
  ]);
  return { projects, parents };
}

function responseFields(
  row: Omit<DraftRow, "description">,
  { projects, parents }: DraftLookups,
) {
  const values = visibleDraftValues(draftValuesOf(row));
  const parent = values.parentTaskId
    ? parents.get(values.parentTaskId)
    : undefined;
  const parentTask =
    parent && parent.projectId === values.projectId
      ? { id: parent.id, key: parent.key, title: parent.title }
      : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: values.projectId,
    project: values.projectId ? (projects.get(values.projectId) ?? null) : null,
    title: values.title,
    status: values.status,
    priority: values.priority,
    assigneeIds: values.assigneeIds,
    labels: values.labels,
    startDate: values.startDate,
    dueDate: values.dueDate,
    customFieldValues: values.customFieldValues,
    cycleId: values.cycleId,
    moduleIds: values.moduleIds,
    estimatePointId: values.estimatePointId,
    parentTaskId: parentTask?.id ?? null,
    parentTask,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The public shape: never the owner id. */
export function toTaskDraft(row: DraftRow, lookups: DraftLookups) {
  return { ...responseFields(row, lookups), description: row.description };
}

export function toTaskDraftSummary(
  row: Omit<DraftRow, "description"> & { hasDescription: boolean },
  lookups: DraftLookups,
) {
  return {
    ...responseFields(row, lookups),
    hasDescription: row.hasDescription,
  };
}

export async function draftResponse(row: DraftRow) {
  return toTaskDraft(row, await loadDraftLookups([row]));
}

export type DraftChange = "created" | "updated" | "deleted" | "published";

// Ids only: draft content never travels through events, and the hint goes
// to the owner's own channel.
export async function publishDraftChanged(
  userId: string,
  workspaceId: string,
  draftId: string,
  action: DraftChange,
) {
  await publishEvent("task_draft.changed", {
    userId,
    workspaceId,
    draftId,
    action,
  });
}
