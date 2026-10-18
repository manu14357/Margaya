import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  customFieldDefinitionTable,
  cycleTable,
  estimatePointTable,
  estimateTable,
  moduleTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { featureDisabledMessage } from "../project/features";
import { hiddenForCurrentRequest } from "../project/visibility";
import { liveTaskCondition } from "../task/scope";
import {
  assertValidTaskStatus,
  validateCustomFieldValue,
} from "../task/validate-task-fields";
import { filterAssignableUsers } from "../utils/assert-assignable-user";
import { validateDateRange } from "../utils/validate-dates";
import type { DraftChanges, DraftValues } from "./normalize";

// Reference checks for a draft write, one query per kind. Only values the
// request sent are checked, against the project the draft ends up in;
// stored values are revalidated when publishing.

export const PROJECT_NOT_FOUND = "Project not found";
export const PROJECT_ARCHIVED = "This project is archived";

export type DraftProject = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  icon: string | null;
  archivedAt: Date | null;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
};

/** The project when it belongs to the workspace, else null. */
export async function loadDraftProject(
  projectId: string,
  workspaceId: string,
): Promise<DraftProject | null> {
  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      archivedAt: projectTable.archivedAt,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        // A trashed project reads as gone (C7).
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

async function assertStatus(status: string, project: DraftProject | null) {
  if (!project) badRequest("Choose a project before setting a status");
  if (status === "archived") badRequest("Drafts can't be archived");
  await assertValidTaskStatus(status, project.id);
}

async function assertCustomFields(
  values: DraftValues["customFieldValues"],
  project: DraftProject | null,
) {
  const notFound = "Custom field not found in this project";
  if (!project) badRequest(notFound);
  const fields = await db
    .select({
      id: customFieldDefinitionTable.id,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
      options: customFieldDefinitionTable.options,
    })
    .from(customFieldDefinitionTable)
    .where(
      and(
        eq(customFieldDefinitionTable.projectId, project.id),
        inArray(
          customFieldDefinitionTable.id,
          values.map((value) => value.fieldId),
        ),
      ),
    );
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const { fieldId, value } of values) {
    const field = byId.get(fieldId);
    if (!field) badRequest(notFound);
    if (value.trim() === "") continue;
    const error = validateCustomFieldValue(
      value,
      field.type as "number" | "boolean" | "date" | "dropdown",
      field.name,
      field.options,
    );
    if (error) badRequest(error);
  }
}

function assertFeature(
  project: DraftProject,
  feature: "cycles" | "modules" | "estimates",
) {
  const enabled = {
    cycles: project.cyclesEnabled,
    modules: project.modulesEnabled,
    estimates: project.estimatesEnabled,
  }[feature];
  if (!enabled) {
    throw new HTTPException(403, { message: featureDisabledMessage(feature) });
  }
}

async function assertCycle(cycleId: string, project: DraftProject | null) {
  const notFound = "Cycle not found in this project";
  if (!project) badRequest(notFound);
  assertFeature(project, "cycles");
  // A completed cycle is accepted: the draft may be published later, and
  // publishing decides.
  const [cycle] = await db
    .select({ id: cycleTable.id })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.id, cycleId),
        eq(cycleTable.projectId, project.id),
        isNull(cycleTable.archivedAt),
      ),
    )
    .limit(1);
  if (!cycle) badRequest(notFound);
}

async function assertModules(
  moduleIds: readonly string[],
  project: DraftProject | null,
) {
  const notFound = "Module not found in this project";
  if (!project) badRequest(notFound);
  assertFeature(project, "modules");
  const found = await db
    .select({ id: moduleTable.id })
    .from(moduleTable)
    .where(
      and(
        inArray(moduleTable.id, [...moduleIds]),
        eq(moduleTable.projectId, project.id),
        isNull(moduleTable.archivedAt),
      ),
    );
  if (found.length !== moduleIds.length) badRequest(notFound);
}

async function assertEstimatePoint(
  pointId: string,
  project: DraftProject | null,
) {
  const notFound = "Estimate point not found in this project";
  if (!project) badRequest(notFound);
  assertFeature(project, "estimates");
  const [point] = await db
    .select({ id: estimatePointTable.id })
    .from(estimatePointTable)
    .innerJoin(
      estimateTable,
      eq(estimateTable.id, estimatePointTable.estimateId),
    )
    .where(
      and(
        eq(estimatePointTable.id, pointId),
        eq(estimateTable.projectId, project.id),
        eq(estimateTable.isActive, true),
      ),
    )
    .limit(1);
  if (!point) badRequest(notFound);
}

async function assertParentTask(
  parentTaskId: string,
  project: DraftProject | null,
) {
  const notFound = "Parent task not found in this project";
  if (!project) badRequest(notFound);
  // Intake and other parent rules are checked again when publishing.
  const [parent] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.id, parentTaskId),
        eq(taskTable.projectId, project.id),
        liveTaskCondition,
      ),
    )
    .limit(1);
  if (!parent) badRequest(notFound);
}

async function assertAssignees(assigneeIds: string[], workspaceId: string) {
  const assignable = await filterAssignableUsers(assigneeIds, workspaceId);
  if (assigneeIds.some((id) => !assignable.has(id))) {
    badRequest("Assignee is not a member of this workspace");
  }
}

/**
 * Checks the sent values of a create or update against the draft's
 * workspace and the project it ends up in. Returns that project (null for
 * a workspace-level draft).
 */
export async function validateDraftChanges({
  workspaceId,
  changes,
  next,
}: {
  workspaceId: string;
  changes: DraftChanges;
  next: DraftValues;
}): Promise<DraftProject | null> {
  const project = next.projectId
    ? await loadDraftProject(next.projectId, workspaceId)
    : null;

  if (changes.projectId) {
    // A restricted project the caller cannot see reads as missing.
    const hidden = await hiddenForCurrentRequest(workspaceId);
    if (!project || hidden.includes(next.projectId ?? "")) {
      throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
    }
    if (project.archivedAt) {
      throw new HTTPException(409, { message: PROJECT_ARCHIVED });
    }
  }

  if (changes.status) await assertStatus(changes.status, project);
  if (changes.assigneeIds?.length) {
    await assertAssignees(changes.assigneeIds, workspaceId);
  }
  if (changes.startDate !== undefined || changes.dueDate !== undefined) {
    validateDateRange(next.startDate, next.dueDate);
  }
  if (changes.customFieldValues?.length) {
    await assertCustomFields(changes.customFieldValues, project);
  }
  if (changes.cycleId) await assertCycle(changes.cycleId, project);
  if (changes.moduleIds?.length) {
    await assertModules(changes.moduleIds, project);
  }
  if (changes.estimatePointId) {
    await assertEstimatePoint(changes.estimatePointId, project);
  }
  if (changes.parentTaskId) {
    await assertParentTask(changes.parentTaskId, project);
  }
  return project;
}
