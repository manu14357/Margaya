import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { workspaceSettingsSchema } from "./response";
import { updateWorkspaceSettingsBody, workspaceIdParam } from "./schema";

export const getWorkspaceSettingsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceSettings",
  path: "/{workspaceId}/settings",
  tags: ["Workspaces"],
  summary: "Get workspace settings",
  description:
    "Settings that live outside the workspace profile, currently its time zone. Any member can read them.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The workspace settings", workspaceSettingsSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace not found"),
  },
});

export const updateWorkspaceSettingsRoute = createRoute({
  method: "patch",
  operationId: "updateWorkspaceSettings",
  path: "/{workspaceId}/settings",
  tags: ["Workspaces"],
  summary: "Update workspace settings",
  description:
    "Set the workspace time zone. Cycle status, cycle day boundaries, project automations and the analytics default zone follow it from the next request; date-only fields keep their stored dates. Needs workspace:update and workspace:manage_settings, like the rest of the workspace settings.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update", "manage_settings"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateWorkspaceSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated settings", workspaceSettingsSchema),
    400: errorResponse("Invalid body or unknown time zone"),
    403: errorResponse(
      "No workspace access, or missing workspace:update or workspace:manage_settings",
    ),
    404: errorResponse("Workspace not found"),
  },
});
