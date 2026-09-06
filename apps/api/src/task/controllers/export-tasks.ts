import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  labelTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { assigneesOfTasks } from "../assignees";
import { inTriageColumnSql } from "../scope";

async function exportTasks(projectId: string) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      archivedAt: taskTable.archivedAt,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    // Intake requests are not board tasks, and their status would not import.
    .where(
      and(
        eq(taskTable.projectId, projectId),
        sql`not ${inTriageColumnSql}`,
        // Trashed tasks read as gone (C7).
        isNull(taskTable.deletedAt),
      ),
    )
    .orderBy(taskTable.position);

  const taskIds = tasks.map((task) => task.id);
  const assigneesByTask = await assigneesOfTasks(taskIds);

  const labelsData =
    taskIds.length > 0
      ? await db
          .select({
            id: labelTable.id,
            name: labelTable.name,
            color: labelTable.color,
            taskId: labelTable.taskId,
          })
          .from(labelTable)
          .where(inArray(labelTable.taskId, taskIds))
      : [];

  const taskLabelsMap = new Map<
    string,
    Array<{ name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        name: label.name,
        color: label.color,
      });
    }
  }

  return {
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      exportedAt: new Date().toISOString(),
    },
    tasks: tasks.map((task) => ({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority || "low",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      startDate: task.startDate ? new Date(task.startDate).toISOString() : null,
      archivedAt: task.archivedAt ? task.archivedAt.toISOString() : null,
      // Older importers read the single first assignee.
      userId: task.userId || null,
      assigneeIds: assigneesByTask.get(task.id) ?? [],
      labels: taskLabelsMap.get(task.id) || [],
    })),
  };
}

export default exportTasks;
