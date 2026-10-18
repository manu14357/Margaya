import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  cancelWorkspaceDeletion,
  getWorkspaceDeletion,
  scheduleWorkspaceDeletion,
} from "../workspace-deletion/service";
import getWorkspaceMemberCtrl from "./controllers/get-workspace-member";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "./controllers/workspace-settings";
import {
  cancelWorkspaceDeletionRoute,
  getWorkspaceDeletionRoute,
  scheduleWorkspaceDeletionRoute,
} from "./deletion-routes";
import {
  workspaceMemberListSchema,
  workspaceMemberProfileSchema,
} from "./response";
import { workspaceIdParam, workspaceMemberParam } from "./schema";
import {
  getWorkspaceSettingsRoute,
  updateWorkspaceSettingsRoute,
} from "./settings-routes";

const getWorkspaceMembersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMembers",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Get workspace members",
  description: "Get all members of a workspace, with their role.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of workspace members", workspaceMemberListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const getWorkspaceMemberRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMember",
  path: "/{workspaceId}/members/{userId}",
  tags: ["Workspaces"],
  summary: "Get a workspace member",
  description:
    "One member's profile header: name, email, avatar, role and when they joined. Only members of the workspace may read it, and only for current members.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceMemberParam },
  responses: {
    200: jsonResponse("The member", workspaceMemberProfileSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Not a member of this workspace"),
  },
});

const workspace = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getWorkspaceSettingsRoute, async (c) =>
    c.json(await getWorkspaceSettings(c.get("workspaceId")), 200),
  )
  .openapi(updateWorkspaceSettingsRoute, async (c) =>
    c.json(
      await updateWorkspaceSettings({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(getWorkspaceDeletionRoute, async (c) =>
    c.json(await getWorkspaceDeletion(c.get("workspaceId")), 200),
  )
  .openapi(scheduleWorkspaceDeletionRoute, async (c) =>
    c.json(
      await scheduleWorkspaceDeletion({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(cancelWorkspaceDeletionRoute, async (c) =>
    c.json(
      await cancelWorkspaceDeletion({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(getWorkspaceMembersRoute, async (c) =>
    c.json(await getWorkspaceMembersCtrl(c.get("workspaceId")), 200),
  )
  .openapi(getWorkspaceMemberRoute, async (c) =>
    c.json(
      await getWorkspaceMemberCtrl(
        c.get("workspaceId"),
        c.req.valid("param").userId,
      ),
      200,
    ),
  );

export default workspace;
