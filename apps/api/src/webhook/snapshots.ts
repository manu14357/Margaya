import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { commentAiProvenance } from "../ai/provenance";
import { getCycleResponse } from "../cycle/controllers/shared";
import db from "../database";
import {
  activityTable,
  columnTable,
  cycleTaskTable,
  estimateTable,
  pageTable,
  projectTable,
  taskRelationTable,
  taskTable,
  timeEntryTable,
  userTable,
} from "../database/schema";
import { pointSnapshots } from "../estimate/assert-task-estimate";
import { pointsOf } from "../estimate/queries";
import { loadIntakeItem } from "../intake/queries";
import { getModuleResponse } from "../module/controllers/shared";
import { pageSummaryColumns, toPageSummary } from "../page/controllers/shared";
import { PROJECT_FEATURE_KEYS, PROJECT_FEATURES } from "../project/features";
import { assigneesOfTasks } from "../task/assignees";
import { taskColumnJoin, taskGroupOf } from "../task/scope";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { loadLabels, loadModules } from "../task-export/related";
import { getViewResponse } from "../view/controllers/shared";
import type { WebhookEntityType } from "./types";

// Entity snapshots for webhook payloads (B13a §2.7.1), loaded when a
// delivery is queued. Each reuses the owning slice's serializer or reader.
// Content of pages is never sent, emails never appear, and fields of a
// turned-off project feature are empty.

export type Snapshot = Record<string, unknown>;

function clientUrl(): string {
  return (process.env.MARGAYA_CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

async function userNames(
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(inArray(userTable.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** `{ id, name }` of a user, or null for none or a deleted account. */
export async function actorOf(
  userId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!userId) return null;
  const name = (await userNames([userId])).get(userId);
  return name === undefined ? null : { id: userId, name };
}

export async function taskSnapshot(taskId: string): Promise<Snapshot | null> {
  const [row] = await db
    .select({
      task: getTableColumns(taskTable),
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
      columnName: columnTable.name,
      columnGroup: columnTable.group,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!row) return null;
  const { task } = row;

  const [assigneeIds, labels, modules, parent, cycle, estimate] =
    await Promise.all([
      assigneesOfTasks([taskId]).then((map) => map.get(taskId) ?? []),
      loadLabels(row.workspaceId, [taskId]).then((map) => map.get(taskId)),
      row.modulesEnabled
        ? loadModules([taskId]).then((map) => map.get(taskId) ?? [])
        : Promise.resolve([]),
      db
        .select({ id: taskRelationTable.sourceTaskId })
        .from(taskRelationTable)
        .where(
          and(
            eq(taskRelationTable.targetTaskId, taskId),
            eq(taskRelationTable.relationType, "subtask"),
          ),
        )
        .limit(1),
      row.cyclesEnabled
        ? db
            .select({ cycleId: cycleTaskTable.cycleId })
            .from(cycleTaskTable)
            .where(eq(cycleTaskTable.taskId, taskId))
            .limit(1)
        : Promise.resolve([]),
      row.estimatesEnabled && task.estimatePointId
        ? pointSnapshots(db, [task.estimatePointId]).then((map) =>
            map.get(task.estimatePointId ?? ""),
          )
        : Promise.resolve(undefined),
    ]);
  const names = await userNames(assigneeIds);
  const group = taskGroupOf(
    task.status,
    row.columnGroup ? { group: row.columnGroup } : null,
  );

  return {
    id: task.id,
    key: formatTaskKey(row.slug, task.number),
    number: task.number,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    // Null unless AI wrote the description (EU AI Act Article 50 marking).
    aiProvenance: task.aiProvenance ?? null,
    status: task.status,
    statusName: row.columnName ?? task.status,
    group,
    priority: task.priority,
    assigneeIds,
    assignees: assigneeIds.map((id) => ({ id, name: names.get(id) ?? "" })),
    createdById: task.createdBy,
    startDate: task.startDate,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    archivedAt: task.archivedAt,
    parentId: parent[0]?.id ?? null,
    cycleId: cycle[0]?.cycleId ?? null,
    moduleIds: modules.map((module) => module.id),
    estimate: estimate
      ? { pointId: estimate.id, value: estimate.value, type: estimate.type }
      : null,
    labels: labels ?? [],
    url: `${clientUrl()}/dashboard/workspace/${row.workspaceId}/project/${task.projectId}/task/${task.id}`,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function commentSnapshot(
  commentId: string,
): Promise<Snapshot | null> {
  const [row] = await db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      content: activityTable.content,
      userId: activityTable.userId,
      externalUserName: activityTable.externalUserName,
      visibility: activityTable.visibility,
      parentId: activityTable.parentId,
      aiProvenance: activityTable.aiProvenance,
      eventData: activityTable.eventData,
      createdAt: activityTable.createdAt,
      updatedAt: activityTable.updatedAt,
      number: taskTable.number,
      slug: projectTable.slug,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(eq(activityTable.id, commentId), eq(activityTable.type, "comment")),
    )
    .limit(1);
  if (!row) return null;
  const author = row.externalUserName ? null : await actorOf(row.userId);
  return {
    id: row.id,
    taskId: row.taskId,
    taskKey: formatTaskKey(row.slug, row.number),
    content: row.content,
    // Null unless AI wrote the comment (EU AI Act Article 50 marking).
    aiProvenance: commentAiProvenance(row),
    visibility: row.visibility,
    // The thread's top-level comment when this is a reply, else null.
    parentId: row.parentId,
    author,
    ...(row.externalUserName ? { externalUserName: row.externalUserName } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function projectSnapshot(
  projectId: string,
): Promise<Snapshot | null> {
  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    icon: project.icon,
    description: project.description,
    isPublic: Boolean(project.isPublic),
    archivedAt: project.archivedAt,
    features: Object.fromEntries(
      PROJECT_FEATURE_KEYS.map((key) => [
        key,
        project[PROJECT_FEATURES[key].field],
      ]),
    ),
    createdAt: project.createdAt,
  };
}

export async function columnSnapshot(
  columnId: string,
): Promise<Snapshot | null> {
  const [column] = await db
    .select({
      id: columnTable.id,
      projectId: columnTable.projectId,
      name: columnTable.name,
      slug: columnTable.slug,
      group: columnTable.group,
      position: columnTable.position,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.id, columnId))
    .limit(1);
  return column ?? null;
}

/** Null instead of the slice's 404 when the row is gone. */
async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export async function cycleSnapshot(cycleId: string): Promise<Snapshot | null> {
  const cycle = await orNull(() => getCycleResponse(cycleId));
  if (!cycle) return null;
  const { today: _today, ...rest } = cycle;
  return rest;
}

export async function moduleSnapshot(
  moduleId: string,
): Promise<Snapshot | null> {
  return orNull(() => getModuleResponse(moduleId));
}

/** The page summary without capabilities, plus contentVersion; no content. */
export async function pageSnapshot(pageId: string): Promise<Snapshot | null> {
  const [row] = await db
    .select({ ...pageSummaryColumns, contentVersion: pageTable.contentVersion })
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .limit(1);
  if (!row) return null;
  const { capabilities: _capabilities, ...summary } = toPageSummary(
    row,
    {
      userId: "",
      canRead: false,
      canCreate: false,
      canUpdate: false,
      isManager: false,
    },
    new Map(),
  );
  return { ...summary, contentVersion: row.contentVersion };
}

export async function viewSnapshot(viewId: string): Promise<Snapshot | null> {
  const view = await orNull(() =>
    getViewResponse(viewId, {
      userId: "",
      canUpdateOwn: false,
      canManageAny: false,
    }),
  );
  if (!view) return null;
  const { canEdit: _canEdit, canDelete: _canDelete, ...rest } = view;
  return rest;
}

export async function intakeSnapshot(
  intakeItemId: string,
): Promise<Snapshot | null> {
  return loadIntakeItem(intakeItemId);
}

export async function estimateSnapshot(
  estimateId: string,
): Promise<Snapshot | null> {
  const [estimate] = await db
    .select()
    .from(estimateTable)
    .where(eq(estimateTable.id, estimateId))
    .limit(1);
  if (!estimate) return null;
  const points = await pointsOf(db, estimate.id);
  return {
    id: estimate.id,
    projectId: estimate.projectId,
    name: estimate.name,
    type: estimate.type,
    isActive: estimate.isActive,
    points: points.map((point) => ({
      id: point.id,
      value: point.value,
      position: point.position,
    })),
  };
}

export async function timeEntrySnapshot(
  timeEntryId: string,
): Promise<Snapshot | null> {
  const [row] = await db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      userId: timeEntryTable.userId,
      description: timeEntryTable.description,
      startTime: timeEntryTable.startTime,
      endTime: timeEntryTable.endTime,
      duration: timeEntryTable.duration,
      number: taskTable.number,
      slug: projectTable.slug,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(eq(timeEntryTable.id, timeEntryId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.taskId,
    taskKey: formatTaskKey(row.slug, row.number),
    user: await actorOf(row.userId),
    description: row.description,
    startTime: row.startTime,
    endTime: row.endTime,
    durationSeconds: row.duration ?? 0,
  };
}

const LOADERS: Partial<
  Record<WebhookEntityType, (id: string) => Promise<Snapshot | null>>
> = {
  task: taskSnapshot,
  comment: commentSnapshot,
  project: projectSnapshot,
  column: columnSnapshot,
  cycle: cycleSnapshot,
  module: moduleSnapshot,
  page: pageSnapshot,
  view: viewSnapshot,
  intake_item: intakeSnapshot,
  estimate: estimateSnapshot,
  time_entry: timeEntrySnapshot,
};

/** The snapshot of one entity, or null when it no longer exists. */
export async function loadSnapshot(
  entity: WebhookEntityType,
  id: string | null,
): Promise<Snapshot | null> {
  const load = LOADERS[entity];
  if (!load || !id) return null;
  return load(id);
}
