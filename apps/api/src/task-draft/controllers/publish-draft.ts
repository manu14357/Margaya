import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type CycleChange,
  publishCycleChanges,
  recordCycleChanges,
  upsertMemberships,
} from "../../cycle/controllers/membership";
import { lockCycle } from "../../cycle/controllers/shared";
import { deriveCycleStatus } from "../../cycle/dates";
import db from "../../database";
import {
  activityTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  taskDraftTable,
  taskRelationTable,
} from "../../database/schema";
import { shareProjectEstimates } from "../../estimate/write";
import { publishEvent } from "../../events";
import {
  type ModuleActivity,
  publishModuleTasksChanged,
  recordModuleActivity,
} from "../../module/controllers/membership";
import type { Transaction } from "../../task/assignee-writes";
import {
  insertTaskInTransaction,
  prepareTaskCreate,
  publishTaskCreated,
} from "../../task/controllers/create-task";
import {
  formatTaskKey,
  type TaskSnapshot,
} from "../../task-activity/task-snapshot";
import {
  type LockedRelationTask,
  lockRelationGraph,
  lockRelationTasks,
  snapshotOfLocked,
} from "../../task-relation/checks";
import {
  publishRelationEvent,
  type RelationRow,
} from "../../task-relation/events";
import { projectToday } from "../../utils/timezone";
import type { DraftValues } from "../normalize";
import { loadPublishFacts, loadPublishProject } from "../publish-facts";
import { buildPublishPlan } from "../publish-plan";
import { DROPPED_DRAFT_FIELDS, type DroppedDraftField } from "../response";
import type { TaskDraftPatch } from "../schema";
import { PROJECT_ARCHIVED } from "../validate";
import { DRAFT_NOT_FOUND, draftValuesOf, publishDraftChanged } from "./shared";
import { applyTaskDraftPatch } from "./write-drafts";

type Task = Awaited<ReturnType<typeof insertTaskInTransaction>>;

/**
 * Adds the new task to the planned cycle, unless it stopped taking tasks.
 * Also used by the task import (B13).
 */
export async function joinCycle(
  tx: Transaction,
  cycleId: string,
  taskId: string,
  userId: string,
): Promise<CycleChange | null> {
  // Locked after the project (claimed by the insert), like cycle writes.
  const cycle = await lockCycle(tx, cycleId);
  if (
    cycle.archivedAt ||
    deriveCycleStatus(cycle, await projectToday(cycle.projectId, tx)) ===
      "completed"
  )
    return null;
  const change: CycleChange = {
    taskId,
    oldCycleId: null,
    oldCycleName: null,
    newCycleId: cycle.id,
    newCycleName: cycle.name,
  };
  await upsertMemberships(tx, cycle.id, [taskId], userId);
  await recordCycleChanges(tx, [change], userId);
  return change;
}

/** Adds the new task to the active modules among `moduleIds` (B13 too). */
export async function joinModules(
  tx: Transaction,
  moduleIds: readonly string[],
  projectId: string,
  taskId: string,
  userId: string,
): Promise<ModuleActivity[]> {
  if (moduleIds.length === 0) return [];
  const modules = await tx
    .select({ id: moduleTable.id, name: moduleTable.name })
    .from(moduleTable)
    .where(
      and(
        inArray(moduleTable.id, [...moduleIds]),
        eq(moduleTable.projectId, projectId),
        isNull(moduleTable.archivedAt),
      ),
    )
    .for("update");
  if (modules.length === 0) return [];
  await tx
    .insert(moduleTaskTable)
    .values(
      modules.map((found) => ({
        moduleId: found.id,
        taskId,
        createdBy: userId,
      })),
    )
    .onConflictDoNothing();
  const entries: ModuleActivity[] = modules.map((found) => ({
    taskId,
    moduleId: found.id,
    moduleName: found.name,
    type: "module_added",
  }));
  await recordModuleActivity(tx, entries, userId);
  return entries;
}

/**
 * The draft's parent, locked like a create with a parent does, when it may
 * still take the new task: a live task of the same project, not waiting in
 * intake. Null means the parent is dropped.
 */
async function lockDraftParent(
  tx: Transaction,
  parentTaskId: string,
  projectId: string,
  workspaceId: string,
): Promise<LockedRelationTask | null> {
  await lockRelationGraph(tx, workspaceId);
  const parent = (await lockRelationTasks(tx, [parentTaskId])).get(
    parentTaskId,
  );
  if (
    !parent ||
    parent.workspaceId !== workspaceId ||
    parent.projectId !== projectId ||
    parent.inTriage
  ) {
    return null;
  }
  return parent;
}

type PublishResult = {
  task: Task;
  parentLink: {
    relation: RelationRow;
    snapshots: Map<string, TaskSnapshot>;
  } | null;
  assigneeIds: string[];
  currentUserId: string;
  key: string;
  labels: { name: string; color: string }[];
  cycleChange: CycleChange | null;
  moduleEntries: ModuleActivity[];
  dropped: DroppedDraftField[];
  workspaceId: string;
};

function refuse(status: 400 | 409, message: string): never {
  throw new HTTPException(status, { message });
}

/** §3.1.6 phase 2: one transaction from the locked draft to its task. */
async function publishLockedDraft(
  tx: Transaction,
  draftId: string,
  userId: string,
  canLinkParent: boolean,
): Promise<PublishResult> {
  // A concurrent publish or delete waits here and then finds nothing.
  const [row] = await tx
    .select()
    .from(taskDraftTable)
    .where(
      and(eq(taskDraftTable.id, draftId), eq(taskDraftTable.createdBy, userId)),
    )
    .for("update");
  if (!row) throw new HTTPException(404, { message: DRAFT_NOT_FOUND });
  const draft: DraftValues = draftValuesOf(row);

  if (!draft.projectId) refuse(400, "Choose a project before publishing");
  if (!draft.title.trim()) {
    refuse(400, "Give the task a title before publishing");
  }
  const project = await loadPublishProject(
    tx,
    draft.projectId,
    row.workspaceId,
  );
  if (!project) refuse(400, "Choose a project before publishing");
  if (project.archivedAt) refuse(409, PROJECT_ARCHIVED);

  // Holds the estimate systems still until commit, so the point checked
  // below stays active.
  if (draft.estimatePointId && project.estimatesEnabled) {
    await shareProjectEstimates(tx, project.id);
  }
  const plan = buildPublishPlan(
    draft,
    await loadPublishFacts(tx, draft, project),
  );
  const dropped = [...plan.dropped];

  const prepared = await prepareTaskCreate({
    projectId: project.id,
    currentUserId: userId,
    assigneeIds: plan.assigneeIds,
    title: draft.title,
    status: plan.status,
    startDate: draft.startDate ?? undefined,
    dueDate: draft.dueDate ?? undefined,
    description: draft.description,
    priority: draft.priority,
    customFields: plan.customFieldValues,
    estimatePointId: plan.estimatePointId,
  });
  let parent: LockedRelationTask | null = null;
  if (draft.parentTaskId) {
    parent =
      canLinkParent && prepared.column?.group !== "triage"
        ? await lockDraftParent(
            tx,
            draft.parentTaskId,
            project.id,
            row.workspaceId,
          )
        : null;
    if (!parent) dropped.push("parent");
  }
  const task = await insertTaskInTransaction(tx, prepared);

  let parentLink: PublishResult["parentLink"] = null;
  if (parent) {
    const [relation] = await tx
      .insert(taskRelationTable)
      .values({
        sourceTaskId: parent.id,
        targetTaskId: task.id,
        relationType: "subtask",
      })
      .returning();
    if (relation) {
      parentLink = {
        relation,
        snapshots: new Map<string, TaskSnapshot>([
          [parent.id, snapshotOfLocked(parent)],
          [
            task.id,
            {
              id: task.id,
              key: formatTaskKey(parent.slug, task.number),
              title: task.title,
              projectId: task.projectId,
            },
          ],
        ]),
      };
    }
  }

  // The "created" row is written here, a moment before the membership rows
  // below, so the history reads in order; task.created then skips it.
  await tx.insert(activityTable).values({
    taskId: task.id,
    type: "created",
    userId,
    content: null,
    eventData: {},
    createdAt: sql`now() - interval '1 millisecond'`,
  });

  const labels =
    draft.labels.length > 0
      ? await tx
          .insert(labelTable)
          .values(
            draft.labels.map((label) => ({
              ...label,
              taskId: task.id,
              workspaceId: row.workspaceId,
            })),
          )
          .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
          .returning({ name: labelTable.name, color: labelTable.color })
      : [];

  let cycleChange: CycleChange | null = null;
  if (plan.cycleId) {
    cycleChange = await joinCycle(tx, plan.cycleId, task.id, userId);
    if (!cycleChange) dropped.push("cycle");
  }
  const moduleEntries = await joinModules(
    tx,
    plan.moduleIds,
    project.id,
    task.id,
    userId,
  );
  if (moduleEntries.length !== plan.moduleIds.length) {
    if (!dropped.includes("modules")) dropped.push("modules");
  }

  await tx.delete(taskDraftTable).where(eq(taskDraftTable.id, draftId));

  dropped.sort(
    (a, b) => DROPPED_DRAFT_FIELDS.indexOf(a) - DROPPED_DRAFT_FIELDS.indexOf(b),
  );
  return {
    task,
    parentLink,
    assigneeIds: prepared.assigneeIds,
    currentUserId: userId,
    key: `${project.slug}-${task.number}`,
    labels,
    cycleChange,
    moduleEntries,
    dropped,
    workspaceId: row.workspaceId,
  };
}

async function publishAfterCommit(result: PublishResult, draftId: string) {
  const { task, currentUserId: userId } = result;
  try {
    await publishTaskCreated(task, result, { source: "draft" });
    // The event the create route sends for a subtask created with its parent.
    if (result.parentLink) {
      await publishRelationEvent("task-relation.created", {
        relation: result.parentLink.relation,
        userId,
        origin: "user",
        snapshots: result.parentLink.snapshots,
      });
    }
    for (const label of result.labels) {
      await publishEvent("task.label_created", {
        projectId: task.projectId,
        taskId: task.id,
        userId,
        label,
        type: "label_created",
      });
    }
    if (result.cycleChange) {
      await publishCycleChanges({
        projectId: task.projectId,
        userId,
        changes: [result.cycleChange],
      });
    }
    for (const entry of result.moduleEntries) {
      await publishModuleTasksChanged({
        projectId: task.projectId,
        userId,
        moduleId: entry.moduleId,
        moduleName: entry.moduleName,
        added: [task.id],
        removed: [],
      });
    }
    await publishDraftChanged(userId, result.workspaceId, draftId, "published");
  } catch (error) {
    // The task exists and the draft is gone; only hints were lost.
    console.error(`Failed to publish the events of draft ${draftId}`, error);
  }
}

/**
 * Publishes the caller's draft: a patch in the body is saved first (and
 * kept even when publishing then fails), then one transaction turns the
 * draft into a task and deletes it.
 */
export async function publishTaskDraft({
  draftId,
  userId,
  patch,
  canLinkParent = false,
}: {
  draftId: string;
  userId: string;
  patch: TaskDraftPatch;
  /** task:update: without it a stored parent is dropped, not linked. */
  canLinkParent?: boolean;
}) {
  const hasPatch = Object.values(patch).some((value) => value !== undefined);
  if (hasPatch) await applyTaskDraftPatch({ draftId, userId, patch });

  const result = await db.transaction((tx) =>
    publishLockedDraft(tx, draftId, userId, canLinkParent),
  );
  await publishAfterCommit(result, draftId);

  return {
    task: { ...result.task, assigneeIds: result.assigneeIds },
    key: result.key,
    dropped: result.dropped,
  };
}
