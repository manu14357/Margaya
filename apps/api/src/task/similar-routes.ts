import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { similarTasksSchema } from "./response";
import { projectIdParam, similarTasksQuery } from "./schema";

export const similarTasksRoute = createRoute({
  method: "get",
  operationId: "findSimilarTasks",
  path: "/similar/{projectId}",
  tags: ["Tasks"],
  summary: "Find tasks like a title",
  description:
    "Open tasks of the project like the title in `q`, for duplicate hints while a new task's title is typed. Ranked by full-text search over titles and descriptions: a task matching every significant word, or whose title shares most of them. At most five; empty for fewer than two significant words. Needs task:read.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: projectIdParam, query: similarTasksQuery },
  responses: {
    200: jsonResponse("Similar open tasks", similarTasksSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access or missing task:read permission"),
    503: errorResponse("The search timed out"),
  },
});
