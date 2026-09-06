import type { RouteHandler } from "@hono/zod-openapi";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { setTaskArchived } from "./archive";
import { taskSchema } from "./response";
import { taskParam } from "./schema";

// Chained into the task router: POST /task/archive/{id} and
// POST /task/unarchive/{id}.

export const archiveTaskRoute = createRoute({
  method: "post",
  operationId: "archiveTask",
  path: "/archive/{id}",
  tags: ["Tasks"],
  summary: "Archive task",
  description:
    "Archive a task from any column. It keeps its column, position, dates and completion; archived tasks leave the board columns, progress, reminders and default task queries until restored. Archiving an archived task changes nothing. Tasks waiting in intake answer 409.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The task", taskSchema),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    409: errorResponse(
      "The task is waiting in intake; accept it from the Intake tab instead",
    ),
  },
});

export const unarchiveTaskRoute = createRoute({
  method: "post",
  operationId: "unarchiveTask",
  path: "/unarchive/{id}",
  tags: ["Tasks"],
  summary: "Restore task",
  description:
    "Restore an archived task to its column, where it keeps its old position. Restoring a task that is not archived changes nothing.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The task", taskSchema),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    409: errorResponse(
      "The task is waiting in intake; accept it from the Intake tab instead",
    ),
  },
});

type Variables = { Variables: BaseVariables & { workspaceId: string } };

export const archiveTaskHandler: RouteHandler<
  typeof archiveTaskRoute,
  Variables
> = async (c) =>
  c.json(
    await setTaskArchived({
      taskId: c.req.valid("param").id,
      archived: true,
      userId: c.get("userId"),
    }),
    200,
  );

export const unarchiveTaskHandler: RouteHandler<
  typeof unarchiveTaskRoute,
  Variables
> = async (c) =>
  c.json(
    await setTaskArchived({
      taskId: c.req.valid("param").id,
      archived: false,
      userId: c.get("userId"),
    }),
    200,
  );
