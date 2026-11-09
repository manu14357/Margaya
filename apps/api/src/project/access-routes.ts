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
  projectRoleStatements,
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
import {
  projectAccessSchema,
  projectPeopleSchema,
  projectRightsListSchema,
} from "./response";
import {
  addProjectMemberBody,
  projectMemberParam,
  projectParam,
  updateProjectMemberBody,
  updateProjectVisibilityBody,
  workspaceIdQuery,
} from "./schema";
import {
  cappingProjectRoles,
  isWorkspaceGuest,
  PROJECT_NOT_FOUND,
  projectPeople,
} from "./visibility";

/**
 * Changing who can reach a project takes project:share (workspace owners
 * and admins by default), or being the project's lead. A guest manages
 * nothing, even as lead.
 */
export async function canManageProjectAccess(c: Context, projectId: string) {
  if (await hasWorkspacePermission(c, { project: ["share"] })) return true;
  if (await isWorkspaceGuest(c.get("userId"), c.get("workspaceId"))) {
    return false;
  }
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
  "Unknown project, a restricted project the caller is not a member of, or any project a workspace guest was not added to";

const getAccessRoute = createRoute({
  method: "get",
  operationId: "getProjectAccess",
  path: "/{id}/access",
  tags: ["Projects"],
  summary: "Get project access",
  description:
    "The project's visibility and member list. An open project is reached through workspace roles. A restricted one is reached only by its members and by workspace owners and admins; there each member's rights are what both their workspace role and their project role grant. A workspace guest reaches only the projects they are members of, open or restricted, under the same rule, and can't read this list (404).",
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

const projectRead = [
  workspaceAccess.fromProject("id", { notFoundMessage: PROJECT_NOT_FOUND }),
  requireWorkspacePermission({ project: ["read"] }),
] as const;

const getRightsRoute = createRoute({
  method: "get",
  operationId: "getMyProjectRights",
  path: "/access/mine",
  tags: ["Projects"],
  summary: "Get my project roles in a workspace",
  description:
    "The projects of the workspace where a project role caps your rights, each with that role and what it grants: every project of a workspace guest, and the restricted projects you are a member of unless you are a workspace owner or admin. There you may do what both your workspace role and the project role grant; anywhere else only your workspace role counts. One call covers the workspace, so clients can show only the actions the API will accept on any task.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse(
      "Your capping project roles and what they grant",
      projectRightsListSchema,
    ),
    403: errorResponse("No workspace access, or missing project:read"),
  },
});

const getPeopleRoute = createRoute({
  method: "get",
  operationId: "getProjectPeople",
  path: "/{id}/people",
  tags: ["Projects"],
  summary: "List the people of a project",
  description:
    "The workspace members who can see the project, by name: whom a picker in the project may offer as assignee or mention. Ids, names and avatars only. Open to anyone who reaches the project, a guest included, without revealing the rest of the workspace.",
  middleware: [...projectRead] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse(
      "The people who can see the project",
      projectPeopleSchema,
    ),
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
    "Add a workspace member to the project with a project role (viewer, member, admin, or a custom workspace role). The role caps their rights in a restricted project, and a workspace guest's rights in any project; it never grants more than their workspace role. This is how a guest gets a project at all.",
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
    "Remove someone from the project's members. In a restricted project they lose access at once, including their realtime connections, unless they are a workspace owner or admin. A workspace guest loses access in any project.",
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
  .openapi(getRightsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const roles = await cappingProjectRoles(c.get("userId"), workspaceId);
    const byRole = new Map<string, Record<string, string[]>>();
    for (const { projectRole } of roles) {
      if (byRole.has(projectRole)) continue;
      const granted = await projectRoleStatements(workspaceId, projectRole);
      byRole.set(
        projectRole,
        Object.fromEntries(
          Object.entries(granted).map(([resource, actions]) => [
            resource,
            [...actions],
          ]),
        ),
      );
    }
    return c.json(
      {
        projects: roles.map(({ projectId, projectRole }) => ({
          projectId,
          projectRole,
          statements: byRole.get(projectRole) ?? {},
        })),
      },
      200,
    );
  })
  .openapi(getPeopleRoute, async (c) =>
    c.json(await projectPeople(c.req.valid("param").id), 200),
  )
  .openapi(getAccessRoute, async (c) => {
    const { id } = c.req.valid("param");
    // The member list is not a guest's to read.
    if (await isWorkspaceGuest(c.get("userId"), c.get("workspaceId"))) {
      throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
    }
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
