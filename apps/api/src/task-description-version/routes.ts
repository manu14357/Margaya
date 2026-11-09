import type { RouteHandler } from "@hono/zod-openapi";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { taskSchema } from "../task/response";
import { taskParam } from "../task/schema";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  getDescriptionVersion,
  listDescriptionVersions,
  restoreDescriptionVersion,
} from "./controllers";
import {
  taskDescriptionVersionDetailSchema,
  taskDescriptionVersionListSchema,
} from "./response";
import { descriptionVersionParam } from "./schema";

// Chained into the task router: GET /task/{id}/description-versions,
// GET /task/{id}/description-versions/{versionId} and
// POST /task/{id}/description-versions/{versionId}/restore.

export const listDescriptionVersionsRoute = createRoute({
  method: "get",
  operationId: "listTaskDescriptionVersions",
  path: "/{id}/description-versions",
  tags: ["Tasks"],
  summary: "List description versions",
  description:
    "The task description's saved versions, newest first (at most 50), each with its author, time, size and a plain-text preview. Saves by the same person within 10 minutes update their newest version; a restore always adds one. The first change of a task without history also keeps the text it replaced, with no author.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The versions", taskDescriptionVersionListSchema),
    403: errorResponse("No workspace access, or missing task:read permission"),
    404: lookupNotFound("task"),
  },
});

export const getDescriptionVersionRoute = createRoute({
  method: "get",
  operationId: "getTaskDescriptionVersion",
  path: "/{id}/description-versions/{versionId}",
  tags: ["Tasks"],
  summary: "Get description version",
  description: "One saved version of the task description, with its markdown.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: descriptionVersionParam },
  responses: {
    200: jsonResponse("The version", taskDescriptionVersionDetailSchema),
    403: errorResponse("No workspace access, or missing task:read permission"),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or an unknown version",
    ),
  },
});

export const restoreDescriptionVersionRoute = createRoute({
  method: "post",
  operationId: "restoreTaskDescriptionVersion",
  path: "/{id}/description-versions/{versionId}/restore",
  tags: ["Tasks"],
  summary: "Restore description version",
  description:
    "Make the description that version's text. It is saved like any description edit (history row, events, realtime updates, mentions) and recorded as a new version.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: { params: descriptionVersionParam },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or an unknown version",
    ),
  },
});

type Variables = { Variables: BaseVariables & { workspaceId: string } };

export const listDescriptionVersionsHandler: RouteHandler<
  typeof listDescriptionVersionsRoute,
  Variables
> = async (c) =>
  c.json(await listDescriptionVersions(c.req.valid("param").id), 200);

export const getDescriptionVersionHandler: RouteHandler<
  typeof getDescriptionVersionRoute,
  Variables
> = async (c) => {
  const { id, versionId } = c.req.valid("param");
  return c.json(await getDescriptionVersion(id, versionId), 200);
};

export const restoreDescriptionVersionHandler: RouteHandler<
  typeof restoreDescriptionVersionRoute,
  Variables
> = async (c) => {
  const { id, versionId } = c.req.valid("param");
  return c.json(
    await restoreDescriptionVersion({
      taskId: id,
      versionId,
      userId: c.get("userId"),
    }),
    200,
  );
};
