import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  addProjectMember,
  getProjectAccess,
  removeProjectMember,
  setProjectVisibility,
  updateProjectMemberRole,
} from "./access";
import { projectAccessSchema } from "./response";
import {
  addProjectMemberBody,
  projectMemberParam,
  projectParam,
  updateProjectMemberBody,
  updateProjectVisibilityBody,
} from "./schema";
import { PROJECT_NOT_FOUND } from "./visibility";

/**
 * Changing who can reach a project takes project:share (workspace owners
 * and admins by default), or being the project's lead.
 */
async function canManageProjectAccess(c: Context, projectId: string) {
  if (await hasWorkspacePermission(c, { project: ["share"] })) return true;
  const [project] = await db
    .select({ leadUserId: projectTable.leadUserId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return Boolean(project?.leadUserId && project.leadUserId === c.get("userId"));
}

async function assertCanManage(c: Context, projectId: string) {
  if (!(await canManageProjectAccess(c, projectId))) {
    throw new HTTPException(403, {
      message:
        "Changing project access needs project:share, or being the project lead",
    });
  }
}

async function accessResponse(c: Context, projectId: string) {
  return {
    ...(await getProjectAccess(projectId)),
    canManage: await canManageProjectAccess(c, projectId),
  };
}

const MANAGE_403 =
  "No workspace access, or neither project:share nor the project lead";
const HIDDEN_404 =
  "Unknown project, or a restricted project the caller is not a member of";

const getAccessRoute = createRoute({
  method: "get",
  operationId: "getProjectAccess",
  path: "/{id}/access",
  tags: ["Projects"],
  summary: "Get project access",
  description:
    "The project's visibility and member list. An open project is reached through workspace roles. A restricted one is reached only by its members and by workspace owners and admins; there each member's rights are what both their workspace role and their project role grant.",
  middleware: [
    workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The project's access settings", projectAccessSchema),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse(HIDDEN_404),
  },
});

const updateVisibilityRoute = createRoute({
  method: "put",
  operationId: "updateProjectVisibility",
  path: "/{id}/access/visibility",
  tags: ["Projects"],
  summary: "Set project visibility",
  description:
    "Switch a project between open and restricted. Restricting it adds the caller and the project lead as members, so they keep access; members of other workspace roles lose access at once, including their realtime connections. Opening it again keeps the member list for later.",
  middleware: [
    workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateProjectVisibilityBody },
      },
    },
  },
  responses: {
    200: jsonResponse("The updated access settings", projectAccessSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(MANAGE_403),
    404: errorResponse(HIDDEN_404),
  },
});

const addMemberRoute = createRoute({
  method: "post",
  operationId: "addProjectMember",
  path: "/{id}/access/members",
  tags: ["Projects"],
  summary: "Add project member",
  description:
    "Add a workspace member to the project with a project role (viewer, member, admin, or a custom workspace role). The role caps their rights in a restricted project; it never grants more than their workspace role.",
  middleware: [
    workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: addProjectMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated access settings", projectAccessSchema),
    400: errorResponse(
      "Invalid body, a user outside the workspace, or an unknown role",
    ),
    403: errorResponse(MANAGE_403),
    404: errorResponse(HIDDEN_404),
    409: errorResponse("Already a member of this project"),
  },
});

const updateMemberRoute = createRoute({
  method: "patch",
  operationId: "updateProjectMember",
  path: "/{id}/access/members/{userId}",
  tags: ["Projects"],
  summary: "Change project member role",
  description: "Change a project member's project role.",
  middleware: [
    workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    params: projectMemberParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated access settings", projectAccessSchema),
    400: errorResponse("Invalid body, or an unknown role"),
    403: errorResponse(MANAGE_403),
    404: errorResponse(`${HIDDEN_404}, or not a project member`),
  },
});

const removeMemberRoute = createRoute({
  method: "delete",
  operationId: "removeProjectMember",
  path: "/{id}/access/members/{userId}",
  tags: ["Projects"],
  summary: "Remove project member",
  description:
    "Remove someone from the project's members. In a restricted project they lose access at once, including their realtime connections, unless they are a workspace owner or admin.",
  middleware: [
    workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: projectMemberParam },
  responses: {
    200: jsonResponse("The updated access settings", projectAccessSchema),
    403: errorResponse(MANAGE_403),
    404: errorResponse(`${HIDDEN_404}, or not a project member`),
  },
});

const projectAccessRoutes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getAccessRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await accessResponse(c, id), 200);
  })
  .openapi(updateVisibilityRoute, async (c) => {
    const { id } = c.req.valid("param");
    await assertCanManage(c, id);
    await setProjectVisibility({
      projectId: id,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      visibility: c.req.valid("json").visibility,
    });
    return c.json(await accessResponse(c, id), 200);
  })
  .openapi(addMemberRoute, async (c) => {
    const { id } = c.req.valid("param");
    await assertCanManage(c, id);
    const { userId, role } = c.req.valid("json");
    await addProjectMember({
      projectId: id,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      memberUserId: userId,
      role,
    });
    return c.json(await accessResponse(c, id), 200);
  })
  .openapi(updateMemberRoute, async (c) => {
    const { id, userId } = c.req.valid("param");
    await assertCanManage(c, id);
    await updateProjectMemberRole({
      projectId: id,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      memberUserId: userId,
      role: c.req.valid("json").role,
    });
    return c.json(await accessResponse(c, id), 200);
  })
  .openapi(removeMemberRoute, async (c) => {
    const { id, userId } = c.req.valid("param");
    await assertCanManage(c, id);
    await removeProjectMember({
      projectId: id,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      memberUserId: userId,
    });
    return c.json(await accessResponse(c, id), 200);
  });

export default projectAccessRoutes;
