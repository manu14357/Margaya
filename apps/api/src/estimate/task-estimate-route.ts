import type { RouteHandler } from "@hono/zod-openapi";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { taskSchema } from "../task/response";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import setTaskEstimate from "./controllers/set-task-estimate";
import { taskEstimateBody, taskParam } from "./schema";

// Defined here and chained into the task router, so it is served at
// PUT /task/estimate/{id} next to the other single-field task routes.

export const updateTaskEstimateRoute = createRoute({
  method: "put",
  operationId: "updateTaskEstimate",
  path: "/estimate/{id}",
  tags: ["Tasks"],
  summary: "Update task estimate",
  description:
    "Set a task's estimate to a value of its project's active estimate system, or send null to clear it. An unchanged value records nothing.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireProjectFeature("estimates", { resource: "task", key: "id" }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: taskEstimateBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse(
      "Invalid body, unknown task, or the value is not in the project's active estimate system",
    ),
    403: errorResponse(
      "No workspace access, missing task:update permission, or the Estimates feature is turned off for this project",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskEstimateHandler: RouteHandler<
  typeof updateTaskEstimateRoute,
  { Variables: BaseVariables & { workspaceId: string } }
> = async (c) =>
  c.json(
    await setTaskEstimate({
      taskId: c.req.valid("param").id,
      estimatePointId: c.req.valid("json").estimatePointId,
      userId: c.get("userId"),
    }),
    200,
  );
