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
import { shareProjectEstimates } from "../../estimate/write";
import { publishEvent } from "../../events";
import { assertTasksNotInTriage } from "../../intake/guards";
import {
  detachTaskFromOtherProjectModules,
  publishModuleDetachments,
} from "../../module/controllers/membership";
import { canSeeProject } from "../../project/visibility";
import { withAssigneeIds } from "../assignees";
import { completedAtAssignment } from "../scope";
import { claimTaskNumber } from "./claim-task-numbers";
import { nextTaskPosition } from "./next-task-position";

function isSameProjectMove(
  sourceProjectId: string,
  destinationProjectId: string,
) {
  return sourceProjectId === destinationProjectId;
}

async function resolveDestinationStatus(
  destinationProjectId: string,
  currentStatus: string,
  requestedStatus?: string,
) {
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

  const [firstColumn] = destinationColumns;

  if (!firstColumn) {
    throw new HTTPException(400, {
      message: "Destination project does not have a workflow",
    });
  }

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

  return requestedColumn ?? matchingCurrentColumn ?? firstColumn;
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

  const destinationProject = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, destinationProjectId),
      eq(projectTable.workspaceId, sourceProject.workspaceId),
      // A trashed project reads as gone (C7).
      isNull(projectTable.deletedAt),
    ),
  });
  // A restricted destination the caller cannot see reads as missing.
  if (
    !destinationProject ||
    !(await canSeeProject(currentUserId, destinationProject.id))
  ) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const resolvedColumn = await resolveDestinationStatus(
    destinationProjectId,
    existingTask.status,
    destinationStatus,
  );

  const { movedTask, cycleChange, moduleDetachments, estimateChanges } =
    await db.transaction(async (tx) => {
      // Waits out a remap of the source project's estimates, then locks the
      // task, so the estimate recorded below is exactly the one cleared.
      await shareProjectEstimates(tx, existingTask.projectId);
      const [locked] = await tx
        .select({ estimatePointId: taskTable.estimatePointId })
        .from(taskTable)
        .where(eq(taskTable.id, taskId))
        .for("update");

      const nextTaskNumber = await claimTaskNumber(destinationProjectId, tx);
      const nextPosition = await nextTaskPosition(
        tx,
        destinationProjectId,
        resolvedColumn.slug,
        resolvedColumn.id,
      );

      const [updatedTask] = await tx
        .update(taskTable)
        .set({
          projectId: destinationProjectId,
          status: resolvedColumn.slug,
          columnId: resolvedColumn.id,
          completedAt: completedAtAssignment(resolvedColumn.group, new Date()),
          number: nextTaskNumber,
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
      const cycleChange = await detachTaskFromCycle(tx, taskId, currentUserId);
      const moduleDetachments = await detachTaskFromOtherProjectModules(
        tx,
        taskId,
        destinationProjectId,
        currentUserId,
      );

      const estimateChanges: TaskEstimateChange[] = [];
      const oldPointId = locked?.estimatePointId ?? null;
      if (oldPointId) {
        const snapshots = await pointSnapshots(tx, [oldPointId]);
        estimateChanges.push(
          estimateChange(
            updatedTask,
            snapshots.get(oldPointId) ?? null,
            null,
            "task_moved",
          ),
        );
        await recordEstimateChanges(tx, estimateChanges, currentUserId);
      }

      return {
        movedTask: updatedTask,
        cycleChange,
        moduleDetachments,
        estimateChanges,
      };
    });

  await publishEvent("task.moved", {
    taskId,
    type: "moved",
    userId: currentUserId,
    fromProjectId: sourceProject.id,
    fromProjectName: sourceProject.name,
    toProjectId: destinationProject.id,
    toProjectName: destinationProject.name,
    oldStatus: existingTask.status,
    newStatus: resolvedColumn.slug,
  });

  await publishCycleChanges({
    projectId: sourceProject.id,
    userId: currentUserId,
    changes: cycleChange ? [cycleChange] : [],
  });
  await publishModuleDetachments({
    projectId: sourceProject.id,
    userId: currentUserId,
    entries: moduleDetachments,
  });
  await publishEstimateChanges({
    projectId: destinationProject.id,
    userId: currentUserId,
    changes: estimateChanges,
  });

  // Assignees stay: both projects share the workspace, so all stay assignable.
  return {
    task: await withAssigneeIds(movedTask),
    sourceProjectId: sourceProject.id,
    destinationProjectId: destinationProject.id,
  };
}

export default moveTask;
