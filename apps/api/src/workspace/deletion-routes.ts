import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { workspaceDeletionSchema } from "./response";
import { workspaceIdParam } from "./schema";

// Delayed workspace deletion. These routes stay open while the workspace is
// read-only, so its owner can cancel.

const TAGS = ["Workspaces"];

export const getWorkspaceDeletionRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceDeletion",
  path: "/{workspaceId}/deletion",
  tags: TAGS,
  summary: "Get workspace deletion",
  description:
    "Whether a deletion is pending, when it was scheduled, by whom, and when the workspace will be deleted. Any member can read it.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The deletion state", workspaceDeletionSchema),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace not found"),
  },
});

export const scheduleWorkspaceDeletionRoute = createRoute({
  method: "post",
  operationId: "scheduleWorkspaceDeletion",
  path: "/{workspaceId}/deletion",
  tags: TAGS,
  summary: "Schedule workspace deletion",
  description:
    "Schedule the workspace for deletion after the grace period (WORKSPACE_DELETION_GRACE_DAYS, 14 days by default). Until then the workspace is read-only for everyone, its API keys and webhooks stop working, and its members are emailed. The owner can cancel at any time before it is deleted. Scheduling it again changes nothing. Needs workspace:delete.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["delete"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The deletion state", workspaceDeletionSchema),
    403: errorResponse("No workspace access, or missing workspace:delete"),
    404: errorResponse("Workspace not found"),
    409: errorResponse("The workspace still has an active subscription"),
  },
});

export const cancelWorkspaceDeletionRoute = createRoute({
  method: "delete",
  operationId: "cancelWorkspaceDeletion",
  path: "/{workspaceId}/deletion",
  tags: TAGS,
  summary: "Cancel workspace deletion",
  description:
    "Cancel a pending deletion: the workspace is writable again and API keys and webhooks resume. Without a pending deletion it changes nothing. Needs workspace:delete.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["delete"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The deletion state", workspaceDeletionSchema),
    403: errorResponse("No workspace access, or missing workspace:delete"),
    404: errorResponse("Workspace not found"),
  },
});
