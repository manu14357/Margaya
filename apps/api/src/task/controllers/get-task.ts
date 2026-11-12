import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  cycleTable,
  cycleTaskTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { assigneeDetailsOfTasks } from "../assignees";
import { liveTaskCondition } from "../scope";

async function getTask(taskId: string) {
  const task = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      isMilestone: taskTable.isMilestone,
      completedAt: taskTable.completedAt,
      archivedAt: taskTable.archivedAt,
      createdBy: taskTable.createdBy,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      projectId: taskTable.projectId,
      cycleId: cycleTable.id,
      cyclesEnabled: projectTable.cyclesEnabled,
      estimatePointId: taskTable.estimatePointId,
      aiProvenance: taskTable.aiProvenance,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
    .leftJoin(
      cycleTable,
      and(
        eq(cycleTable.id, cycleTaskTable.cycleId),
        eq(cycleTable.projectId, taskTable.projectId),
      ),
    )
    // A trashed task reads as gone (C7).
    .where(and(eq(taskTable.id, taskId), liveTaskCondition))
    .limit(1);

  if (!task.length || !task[0]) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // With the cycles feature off, the task reads as in no cycle.
  const { cyclesEnabled, cycleId, ...rest } = task[0];
  const assignees = (await assigneeDetailsOfTasks([taskId])).get(taskId) ?? [];
  return {
    ...rest,
    assigneeIds: assignees.map((assignee) => assignee.id),
    assignees,
    cycleId: cyclesEnabled ? cycleId : null,
  };
}

export default getTask;
