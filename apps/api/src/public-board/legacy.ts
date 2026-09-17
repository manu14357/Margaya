import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskTable } from "../database/schema";
import { getPublicProject } from "../project/controllers/get-public-project";
import type { GetTasksOptions } from "../task/controllers/get-tasks";
import {
  getDescriptionPage,
  getPublicProjectDescriptionPage,
} from "../task/description-pages";
import { resolveBoard, TASK_NOT_ON_BOARD, visibleOnBoard } from "./board";

// The deprecated /public-project routes (B12 §3.4): unchanged in shape, but
// `{id}` is a link token resolved like the new board routes, so they obey
// unpublish, archive, rotation and the server switch. Old links keep
// working because the backfill gave existing boards their project id.

type Person = { id: string; name: string | null; image: string | null };

function hideAssignees<
  T extends {
    userId: string | null;
    assigneeName: string | null;
    assigneeId: string | null;
    assigneeImage: string | null;
    assigneeIds: string[];
    assignees: Person[];
  },
>(task: T): T {
  return {
    ...task,
    userId: null,
    assigneeName: null,
    assigneeId: null,
    assigneeImage: null,
    assigneeIds: [],
    assignees: [],
  };
}

export async function legacyPublicProject(
  token: string,
  options: GetTasksOptions,
) {
  const board = await resolveBoard(token, null);
  const project = await getPublicProject(board.projectId, options);
  // Unchanged in shape and content (the new board routes apply the other
  // settings); only assignees follow "show assignees".
  if (board.settings.showAssignees) return project;
  return {
    ...project,
    columns: project.columns.map((column) => ({
      ...column,
      tasks: column.tasks.map(hideAssignees),
    })),
    archivedTasks: project.archivedTasks.map(hideAssignees),
    plannedTasks: project.plannedTasks.map(hideAssignees),
  };
}

export async function legacyProjectDescription(
  token: string,
  options: { offset: number; version?: string },
) {
  const board = await resolveBoard(token, null);
  return getPublicProjectDescriptionPage(board.projectId, options);
}

export async function legacyTaskDescription(
  token: string,
  taskId: string,
  options: { offset: number; version?: string },
) {
  const board = await resolveBoard(token, null);
  const [task] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(visibleOnBoard(board), eq(taskTable.id, taskId)))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: TASK_NOT_ON_BOARD });
  return getDescriptionPage(task.id, {
    ...options,
    publicProjectId: board.projectId,
  });
}
