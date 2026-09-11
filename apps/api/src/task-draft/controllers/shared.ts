import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskDraftTable } from "../../database/schema";
import { publishEvent } from "../../events";
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

function responseFields(
  row: Omit<DraftRow, "description">,
  projects: Map<string, DraftProjectSummary>,
) {
  const values = visibleDraftValues(draftValuesOf(row));
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The public shape: never the owner id. */
export function toTaskDraft(
  row: DraftRow,
  projects: Map<string, DraftProjectSummary>,
) {
  return { ...responseFields(row, projects), description: row.description };
}

export function toTaskDraftSummary(
  row: Omit<DraftRow, "description"> & { hasDescription: boolean },
  projects: Map<string, DraftProjectSummary>,
) {
  return {
    ...responseFields(row, projects),
    hasDescription: row.hasDescription,
  };
}

export async function draftResponse(row: DraftRow) {
  return toTaskDraft(row, await loadDraftProjects([row.projectId]));
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
