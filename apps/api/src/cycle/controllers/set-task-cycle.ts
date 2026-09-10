import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireWorkspaceEntitlement } from "../../billing/controllers/require-entitlement";
import db from "../../database";
import {
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { inTriageColumnSql } from "../../task/scope";
import { projectToday } from "../../utils/timezone";
import {
  type CycleChange,
  detachTaskFromCycle,
  publishCycleChanges,
  recordCycleChanges,
  upsertMemberships,
} from "./membership";
import { assertCanReceiveTasks, CYCLE_NOT_FOUND, lockCycle } from "./shared";

async function loadTask(taskId: string) {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      archivedAt: taskTable.archivedAt,
      inTriage: inTriageColumnSql,
    })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

async function loadTargetCycle(cycleId: string) {
  const [cycle] = await db
    .select({
      id: cycleTable.id,
      projectId: cycleTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(eq(cycleTable.id, cycleId))
    .limit(1);
  return cycle ?? null;
}

/**
 * Puts a task in a cycle (moving it from its current one) or, with null,
 * takes it out. A task can always leave its cycle.
 */
async function setTaskCycle({
  taskId,
  cycleId,
  workspaceId,
  userId,
}: {
  taskId: string;
  cycleId: string | null;
  workspaceId: string;
  userId: string;
}) {
  const task = await loadTask(taskId);

  if (cycleId === null) {
    const change = await db.transaction((tx) =>
      detachTaskFromCycle(tx, taskId, userId),
    );
    await publishCycleChanges({
      projectId: task.projectId,
      userId,
      changes: change ? [change] : [],
    });
    return {
      taskId,
      cycleId: null,
      previousCycleId: change?.oldCycleId ?? null,
    };
  }

  const target = await loadTargetCycle(cycleId);
  // A cycle of another workspace looks exactly like a missing one.
  if (!target || target.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  }
  if (target.projectId !== task.projectId) {
    throw new HTTPException(400, {
      message: "Cycle belongs to another project",
    });
  }
  if (task.archivedAt) {
    throw new HTTPException(409, {
      message: "Archived tasks can't be planned",
    });
  }
  if (task.inTriage) {
    throw new HTTPException(409, {
      message: "Tasks in triage can't be planned",
    });
  }
  await requireWorkspaceEntitlement(workspaceId);

  const { previousCycleId, changes } = await db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    assertCanReceiveTasks(cycle, await projectToday(cycle.projectId, tx));

    const [current] = await tx
      .select({ cycleId: cycleTaskTable.cycleId, cycleName: cycleTable.name })
      .from(cycleTaskTable)
      .leftJoin(cycleTable, eq(cycleTable.id, cycleTaskTable.cycleId))
      .where(eq(cycleTaskTable.taskId, taskId))
      .limit(1);
    const previousCycleId = current?.cycleId ?? null;
    if (previousCycleId === cycleId) {
      return { previousCycleId, changes: [] as CycleChange[] };
    }

    const changes: CycleChange[] = [
      {
        taskId,
        oldCycleId: previousCycleId,
        oldCycleName: current?.cycleName ?? null,
        newCycleId: cycleId,
        newCycleName: cycle.name,
      },
    ];
    await upsertMemberships(tx, cycleId, [taskId], userId);
    await recordCycleChanges(tx, changes, userId);
    return { previousCycleId, changes };
  });

  await publishCycleChanges({ projectId: task.projectId, userId, changes });
  return { taskId, cycleId, previousCycleId };
}

export default setTaskCycle;
