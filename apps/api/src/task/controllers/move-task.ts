import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  detachTaskFromCycle,
  publishCycleChanges,
} from "../../cycle/controllers/membership";
import db from "../../database";
import {
  assetTable,
  columnTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { pointSnapshots } from "../../estimate/assert-task-estimate";
import {
  estimateChange,
  publishEstimateChanges,
  recordEstimateChanges,
  type TaskEstimateChange,
} from "../../estimate/task-estimate";
import { shareProjectEstimates, type Transaction } from "../../estimate/write";
import { publishEvent } from "../../events";
import { assertTasksNotInTriage } from "../../intake/guards";
import {
  detachTaskFromOtherProjectModules,
  publishModuleDetachments,
} from "../../module/controllers/membership";
import { canSeeProject } from "../../project/visibility";
import { withAssigneeIds } from "../assignees";
import {
  carryCustomFieldValues,
  dropLabelsFromOtherWorkspaces,
} from "../move-carry-over";
import { completedAtAssignment } from "../scope";
import { claimTaskNumber } from "./claim-task-numbers";
import { nextTaskPosition } from "./next-task-position";

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

export async function loadDestinationColumns(destinationProjectId: string) {
  const destinationColumns = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, destinationProjectId),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));

  if (destinationColumns.length === 0) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

  return destinationColumns;
}

type DestinationColumn = Awaited<
  ReturnType<typeof loadDestinationColumns>
>[number];

/**
 * The requested column, else the column with the task's current status, else
 * the destination's first column.
 */
export function chooseDestinationColumn(
  destinationColumns: DestinationColumn[],
  currentStatus: string,
  requestedStatus?: string,
): DestinationColumn {
  const requestedColumn = requestedStatus
    ? destinationColumns.find((column) => column.slug === requestedStatus)
    : null;

  if (requestedStatus && !requestedColumn) {
    throw new HTTPException(400, {
      message: "Selected status is not valid for the destination project",
    });
  }

  const matchingCurrentColumn = destinationColumns.find(
    (column) => column.slug === currentStatus,
  );

  return (
    requestedColumn ??
    matchingCurrentColumn ??
    (destinationColumns[0] as DestinationColumn)
  );
}

export async function findDestinationProject(
  workspaceId: string,
  destinationProjectId: string,
  userId: string,
) {
  const destinationProject = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, destinationProjectId),
      eq(projectTable.workspaceId, workspaceId),
      // A trashed project reads as gone (C7).
      isNull(projectTable.deletedAt),
    ),
  });
  // A restricted destination the caller cannot see reads as missing.
  if (
    !destinationProject ||
    !(await canSeeProject(userId, destinationProject.id))
  ) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }
  return destinationProject;
}

/**
 * Moves one locked task inside the caller's transaction. Call after
 * claimTaskNumber(s) has locked the destination project, which also keeps
 * positions from colliding (nextTaskPosition).
 */
export async function applyTaskMove(
  tx: Transaction,
  {
    taskId,
    oldEstimatePointId,
    column,
    taskNumber,
    destinationProjectId,
    userId,
  }: {
    taskId: string;
    oldEstimatePointId: string | null;
    column: DestinationColumn;
    taskNumber: number;
    destinationProjectId: string;
    userId: string;
  },
) {
  const nextPosition = await nextTaskPosition(
    tx,
    destinationProjectId,
    column.slug,
    column.id,
  );

  const [updatedTask] = await tx
    .update(taskTable)
    .set({
      projectId: destinationProjectId,
      status: column.slug,
      columnId: column.id,
      completedAt: completedAtAssignment(column.group, new Date()),
      number: taskNumber,
      position: nextPosition,
      // Estimate values belong to the source project's system.
      estimatePointId: null,
    })
    .where(eq(taskTable.id, taskId))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to move task",
    });
  }

  await tx
    .update(assetTable)
    .set({ projectId: destinationProjectId })
    .where(eq(assetTable.taskId, taskId));

  // Cycles and modules belong to one project, so the task leaves them.
  const cycleChange = await detachTaskFromCycle(tx, taskId, userId);
  const moduleDetachments = await detachTaskFromOtherProjectModules(
    tx,
    taskId,
    destinationProjectId,
    userId,
  );

  const estimateChanges: TaskEstimateChange[] = [];
  if (oldEstimatePointId) {
    const snapshots = await pointSnapshots(tx, [oldEstimatePointId]);
    estimateChanges.push(
      estimateChange(
        updatedTask,
        snapshots.get(oldEstimatePointId) ?? null,
        null,
        "task_moved",
      ),
    );
    await recordEstimateChanges(tx, estimateChanges, userId);
  }

  return {
    movedTask: updatedTask,
    cycleChange,
    moduleDetachments,
    estimateChanges,
  };
}

type AppliedMove = Awaited<ReturnType<typeof applyTaskMove>>;
type ProjectRef = { id: string; name: string };

/** Publishes one committed move: activity, realtime and integrations. */
export async function publishTaskMove({
  move,
  sourceProject,
  destinationProject,
  oldStatus,
  userId,
}: {
  move: AppliedMove;
  sourceProject: ProjectRef;
  destinationProject: ProjectRef;
  oldStatus: string;
  userId: string;
}) {
  await publishEvent("task.moved", {
    taskId: move.movedTask.id,
    type: "moved",
    userId,
    fromProjectId: sourceProject.id,
    fromProjectName: sourceProject.name,
    toProjectId: destinationProject.id,
    toProjectName: destinationProject.name,
    oldStatus,
    newStatus: move.movedTask.status,
  });

  await publishCycleChanges({
    projectId: sourceProject.id,
    userId,
    changes: move.cycleChange ? [move.cycleChange] : [],
  });
  await publishModuleDetachments({
    projectId: sourceProject.id,
    userId,
    entries: move.moduleDetachments,
  });
  await publishEstimateChanges({
    projectId: destinationProject.id,
    userId,
    changes: move.estimateChanges,
  });
}

async function moveTask({
  taskId,
  destinationProjectId,
  destinationStatus,
  currentUserId,
}: {
  taskId: string;
  destinationProjectId: string;
  destinationStatus?: string;
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // Accepting is the only way out of intake (B7).
  await assertTasksNotInTriage([taskId]);

  if (isSameProjectMove(existingTask.projectId, destinationProjectId)) {
    throw new HTTPException(400, {
      message: "Task is already in that project",
    });
  }

  const sourceProject = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, existingTask.projectId),
  });
  if (!sourceProject) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const destinationProject = await findDestinationProject(
    sourceProject.workspaceId,
    destinationProjectId,
    currentUserId,
  );

  const resolvedColumn = chooseDestinationColumn(
    await loadDestinationColumns(destinationProjectId),
    existingTask.status,
    destinationStatus,
  );

  const { move, droppedLabels } = await db.transaction(async (tx) => {
    // Waits out a remap of the source project's estimates, then locks the
    // task, so the estimate recorded below is exactly the one cleared.
    await shareProjectEstimates(tx, existingTask.projectId);
    const [locked] = await tx
      .select({ estimatePointId: taskTable.estimatePointId })
      .from(taskTable)
      .where(eq(taskTable.id, taskId))
      .for("update");

    const taskNumber = await claimTaskNumber(destinationProjectId, tx);
    const move = await applyTaskMove(tx, {
      taskId,
      oldEstimatePointId: locked?.estimatePointId ?? null,
      column: resolvedColumn,
      taskNumber,
      destinationProjectId,
      userId: currentUserId,
    });
    await carryCustomFieldValues(tx, [taskId], destinationProjectId);
    const droppedLabels = await dropLabelsFromOtherWorkspaces(
      tx,
      [taskId],
      destinationProject.workspaceId,
    );

    return { move, droppedLabels };
  });

  await publishTaskMove({
    move,
    sourceProject,
    destinationProject,
    oldStatus: existingTask.status,
    userId: currentUserId,
  });
  for (const label of droppedLabels) {
    await publishEvent("task.label_unassigned", {
      label,
      task: move.movedTask,
      projectId: destinationProject.id,
      taskId,
      userId: currentUserId,
      type: "label_unassigned",
    });
  }

  // Assignees stay: both projects share the workspace, so all stay assignable.
  return {
    task: await withAssigneeIds(move.movedTask),
    sourceProjectId: sourceProject.id,
    destinationProjectId: destinationProject.id,
  };
}

export default moveTask;
