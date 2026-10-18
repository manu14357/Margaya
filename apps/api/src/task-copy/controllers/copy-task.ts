import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  columnTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  labelTable,
  projectTable,
  taskLinkTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { canSeeProject } from "../../project/visibility";
import { setTaskAssignees } from "../../task/assignee-writes";
import { claimTaskNumber } from "../../task/controllers/claim-task-numbers";
import { nextTaskPosition } from "../../task/controllers/next-task-position";
import { completedAtForInsert } from "../../task/scope";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import { publishRelationEvent } from "../../task-relation/events";
import { filterAssignableUsers } from "../../utils/assert-assignable-user";
import {
  copyStoredFiles,
  discardCopiedFiles,
  type FileCopy,
  planFileCopies,
} from "../copy-files";
import {
  type CopyOption,
  DEFAULT_COPY_OPTIONS,
  planCopyOptions,
  planCustomFieldValues,
  resolveCopyStatus,
  rewriteAssetUrls,
} from "../copy-plan";
import {
  applyCopyPlanning,
  canKeepEstimate,
  type TargetFeatures,
} from "../copy-planning";
import { type CopySource, loadCopySource } from "../copy-source";

async function loadTargetProject(
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  const [project] = await db
    .select({
      id: projectTable.id,
      slug: projectTable.slug,
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
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  // A restricted target the caller cannot see reads as missing.
  if (!project || !(await canSeeProject(userId, project.id))) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  if (project.archivedAt) {
    throw new HTTPException(409, { message: "This project is archived" });
  }
  return project;
}

function sourceHasData(source: CopySource) {
  const { task } = source;
  return {
    description: Boolean(task.description?.trim()),
    assignees: source.assigneeIds.length > 0,
    labels: source.labels.length > 0,
    dates: Boolean(task.startDate || task.dueDate),
    customFields: [...source.customValues.values()].some((value) =>
      Boolean(value?.trim()),
    ),
    parent: source.parent !== null,
    planning: Boolean(
      source.cycleId || source.moduleIds.length > 0 || task.estimatePointId,
    ),
    links: source.links.length > 0,
    attachments: source.attachmentCount > 0,
  } satisfies Record<CopyOption, boolean>;
}

/**
 * Makes a copy of a task in its own or another project of the workspace,
 * with a new number, at the end of its column. Everything is written in one
 * transaction; files are duplicated in storage first, so the copy never
 * depends on the source's objects. Returns the copy, its key and the
 * requested options that could not be applied.
 */
async function copyTask({
  taskId,
  userId,
  workspaceId,
  projectId,
  title,
  include,
}: {
  taskId: string;
  userId: string;
  workspaceId: string;
  projectId?: string;
  title?: string;
  include?: CopyOption[];
}) {
  const source = await loadCopySource(taskId, workspaceId);
  const target = await loadTargetProject(
    projectId ?? source.task.projectId,
    workspaceId,
    userId,
  );
  const sameProject = target.id === source.task.projectId;

  const copyTitle =
    title === undefined ? `${source.task.title} (copy)` : title.trim();
  if (!copyTitle)
    throw new HTTPException(400, { message: "Title is required" });

  const targetColumns = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, target.id),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));
  const status = resolveCopyStatus(source.task.status, targetColumns);
  if (!status) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

  const { apply, skipped } = planCopyOptions({
    requested: include ?? DEFAULT_COPY_OPTIONS,
    sameProject,
    sourceHas: sourceHasData(source),
  });
  const skip = (option: CopyOption) => {
    apply.delete(option);
    if (!skipped.includes(option)) skipped.push(option);
  };

  const targetFields = await db
    .select({
      id: customFieldDefinitionTable.id,
      name: customFieldDefinitionTable.name,
      required: customFieldDefinitionTable.required,
      defaultValue: customFieldDefinitionTable.defaultValue,
    })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, target.id));
  const customFields = planCustomFieldValues({
    targetFields,
    sourceValues: sameProject ? source.customValues : new Map(),
    copyAll: apply.has("customFields"),
  });
  if (!customFields.ok) {
    throw new HTTPException(400, {
      message: `Custom field "${customFields.missingField}" is required to create a task.`,
    });
  }

  // People who left the workspace are dropped; the rest keep their order.
  let assigneeIds: string[] = [];
  if (apply.has("assignees")) {
    const assignable = await filterAssignableUsers(
      source.assigneeIds,
      workspaceId,
    );
    assigneeIds = source.assigneeIds.filter((id) => assignable.has(id));
    if (assigneeIds.length === 0) skip("assignees");
  }

  const parent = source.parent;
  if (
    apply.has("parent") &&
    (!parent || parent.inTriage || parent.projectId !== target.id)
  ) {
    skip("parent");
  }

  const newTaskId = createId();
  const copies = await planFileCopies({
    sourceTaskId: source.task.id,
    description: apply.has("description") ? source.task.description : null,
    includeAttachments: apply.has("attachments"),
    destination: { workspaceId, projectId: target.id, taskId: newTaskId },
  });
  if (copies.length > 0) await copyStoredFiles(copies);

  const description = apply.has("description")
    ? rewriteAssetUrls(
        source.task.description ?? "",
        new Map(
          copies
            .filter((copy) => copy.surface === "description")
            .map((copy) => [copy.sourceAssetId, copy.newAssetId]),
        ),
      )
    : "";

  const features: TargetFeatures = target;
  let written: Awaited<ReturnType<typeof writeCopy>>;
  try {
    written = await writeCopy({
      source,
      target,
      features,
      newTaskId,
      title: copyTitle,
      description,
      status,
      apply,
      customFieldValues: customFields.values,
      assigneeIds,
      copies,
      userId,
      workspaceId,
    });
  } catch (error) {
    await discardCopiedFiles(copies);
    throw error;
  }

  let planningApplied = written.estimateKept;
  let planningFailed = written.estimateDropped;
  if (apply.has("planning")) {
    const planning = await applyCopyPlanning({
      taskId: newTaskId,
      cycleId: source.cycleId,
      moduleIds: source.moduleIds,
      features,
      workspaceId,
      userId,
    });
    planningApplied ||= planning.applied;
    planningFailed ||= planning.failed;
    if (planningFailed) skip("planning");
    else if (!planningApplied) apply.delete("planning");
  }

  const task = { ...written.task, userId: assigneeIds[0] ?? null, assigneeIds };
  const key = formatTaskKey(target.slug, task.number);
  const included = [...apply];

  await publishEvent("task.created", {
    ...task,
    taskId: task.id,
    userId: task.userId ?? "",
    assigneeIds,
    currentUserId: userId,
    type: "created",
    content: null,
    copiedFromTaskId: source.task.id,
  });
  if (written.parentRelation) {
    await publishRelationEvent("task-relation.created", {
      relation: written.parentRelation,
      userId,
      origin: "copy",
    });
  }
  await publishEvent("task.copied", {
    taskId: task.id,
    projectId: target.id,
    userId,
    sourceTaskId: source.task.id,
    sourceProjectId: source.task.projectId,
    sourceTaskKey: formatTaskKey(source.task.slug, source.task.number),
    sourceTaskTitle: source.task.title,
    copyTaskKey: key,
    copyTaskTitle: task.title,
    included,
    skipped,
  });

  return { task, key, skipped };
}

type WriteCopyInput = {
  source: CopySource;
  target: { id: string };
  features: TargetFeatures;
  newTaskId: string;
  title: string;
  description: string;
  status: NonNullable<ReturnType<typeof resolveCopyStatus>>;
  apply: Set<CopyOption>;
  customFieldValues: { fieldId: string; value: string }[];
  assigneeIds: string[];
  copies: FileCopy[];
  userId: string;
  workspaceId: string;
};

/** The copy's rows, all in one transaction. */
function writeCopy(input: WriteCopyInput) {
  const { source, target, apply, newTaskId, userId } = input;
  return db.transaction(async (tx) => {
    const pointId = source.task.estimatePointId;
    const estimateKept =
      apply.has("planning") && pointId
        ? await canKeepEstimate(tx, target.id, pointId, input.features)
        : false;

    const number = await claimTaskNumber(target.id, tx);
    const position = await nextTaskPosition(
      tx,
      target.id,
      input.status.status,
      input.status.columnId,
    );
    const copyDates = apply.has("dates");
    const [task] = await tx
      .insert(taskTable)
      .values({
        id: newTaskId,
        projectId: target.id,
        userId: null,
        title: input.title,
        description: input.description,
        status: input.status.status,
        columnId: input.status.columnId,
        completedAt: completedAtForInsert(input.status.group, new Date()),
        priority: source.task.priority,
        startDate: copyDates ? source.task.startDate : null,
        dueDate: copyDates ? source.task.dueDate : null,
        number,
        position,
        estimatePointId: estimateKept ? pointId : null,
        createdBy: userId,
      })
      .returning();
    if (!task) throw new HTTPException(500, { message: "Failed to copy task" });

    if (input.customFieldValues.length > 0) {
      await tx.insert(customFieldValueTable).values(
        input.customFieldValues.map(({ fieldId, value }) => ({
          taskId: newTaskId,
          fieldId,
          value,
        })),
      );
    }

    if (apply.has("labels")) {
      await tx
        .insert(labelTable)
        .values(
          source.labels.map((label) => ({
            name: label.name,
            color: label.color,
            taskId: newTaskId,
            workspaceId: input.workspaceId,
          })),
        )
        .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] });
    }

    // Assignees need only task:create here, as on task create.
    if (input.assigneeIds.length > 0) {
      await setTaskAssignees(tx, newTaskId, input.assigneeIds);
    }

    const [parentRelation] =
      apply.has("parent") && source.parent
        ? await tx
            .insert(taskRelationTable)
            .values({
              sourceTaskId: source.parent.id,
              targetTaskId: newTaskId,
              relationType: "subtask",
            })
            .returning()
        : [];

    if (apply.has("links")) {
      // Explicit, increasing timestamps keep the source's order.
      const base = Date.now();
      await tx.insert(taskLinkTable).values(
        source.links.map((link, index) => ({
          taskId: newTaskId,
          url: link.url,
          title: link.title,
          createdBy: userId,
          createdAt: new Date(base + index),
          updatedAt: new Date(base + index),
        })),
      );
    }

    if (input.copies.length > 0) {
      const base = Date.now();
      await tx.insert(assetTable).values(
        input.copies.map((copy, index) => ({
          id: copy.newAssetId,
          createdAt: new Date(base + index),
          workspaceId: input.workspaceId,
          projectId: target.id,
          taskId: newTaskId,
          objectKey: copy.destinationKey,
          filename: copy.filename,
          mimeType: copy.mimeType,
          size: copy.size,
          kind: copy.kind,
          surface: copy.surface,
          createdBy: userId,
        })),
      );
    }

    return {
      task,
      parentRelation: parentRelation ?? null,
      estimateKept,
      estimateDropped:
        apply.has("planning") && Boolean(pointId) && !estimateKept,
    };
  });
}

export default copyTask;
