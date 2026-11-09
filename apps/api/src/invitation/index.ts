import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { isInstanceAdmin } from "../utils/is-instance-admin";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { INVITATION_NOT_FOUND, invitationAccess } from "./access";
import getInvitationDetailsController from "./controllers/get-invitation-details";
import getUserPendingInvitations from "./controllers/get-user-pending-invitations";
import updateInvitationRole from "./controllers/update-invitation-role";
import { setInvitationProjects } from "./projects";
import {
  invitationDetailsSchema,
  invitationProjectsSchema,
  pendingInvitationListSchema,
  workspaceInvitationSchema,
} from "./response";
import {
  invitationParam,
  setInvitationProjectsBody,
  updateInvitationRoleBody,
} from "./schema";

const getPendingRoute = createRoute({
  method: "get",
  operationId: "getUserPendingInvitations",
  path: "/pending",
  tags: ["Invitations"],
  summary: "Get pending invitations",
  description:
    "Get the current user's unexpired, unaccepted invitations. Returns an empty list while the user's email is unverified (`user.emailVerified` in the session is false), so that registering with someone else's address does not reveal their invitations; the emailed invitation link still works.",
  responses: {
    200: jsonResponse(
      "List of pending invitations",
      pendingInvitationListSchema,
    ),
  },
});

const getInvitationRoute = createRoute({
  method: "get",
  operationId: "getInvitationDetails",
  path: "/{id}",
  tags: ["Invitations"],
  summary: "Get invitation details",
  description:
    "Look up an invitation by ID. Always 200 -- an unusable invitation is reported with valid: false and a reason rather than an error status.",
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Invitation details", invitationDetailsSchema),
  },
});

const updateInvitationRoleRoute = createRoute({
  method: "patch",
  operationId: "updateInvitationRole",
  path: "/{id}/role",
  tags: ["Invitations"],
  summary: "Change a pending invitation's role",
  description:
    "Change the role a pending invitation grants when it is accepted. Needs invitation:create and invitation:cancel in the invitation's workspace. Both the new and the current role must be within the caller's own: a role is above yours when it grants any permission statement yours does not. Owners and instance admins have no ceiling.",
  middleware: [
    invitationAccess(),
    requireWorkspacePermission({ invitation: ["create", "cancel"] }),
  ] as const,
  request: {
    params: invitationParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateInvitationRoleBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated invitation", workspaceInvitationSchema),
    400: errorResponse("Invalid body or an unknown role"),
    403: errorResponse(
      "Missing permission, or a role above the caller's own (new or current)",
    ),
    404: errorResponse(INVITATION_NOT_FOUND),
    409: errorResponse("The invitation is no longer pending"),
  },
});

const setInvitationProjectsRoute = createRoute({
  method: "put",
  operationId: "setInvitationProjects",
  path: "/{id}/projects",
  tags: ["Invitations"],
  summary: "Set the projects a pending invitation adds",
  description:
    "Replace the projects the invitee joins when they accept, each with a project role, so a guest starts with their projects. Needs invitation:create in the invitation's workspace and, for every project, what adding a member there needs: project:share (capped by your project role in a restricted project) or being its lead. A guest can't. The invitation's role must be within your own, as for a role change. On acceptance they join the projects still in the workspace; one they already belong to keeps its role.",
  middleware: [
    invitationAccess(),
    requireWorkspacePermission({ invitation: ["create"] }),
  ] as const,
  request: {
    params: invitationParam,
    body: {
      required: true,
      content: { "application/json": { schema: setInvitationProjectsBody } },
    },
  },
  responses: {
    200: jsonResponse("The invitation's projects", invitationProjectsSchema),
    400: errorResponse(
      "Invalid body, a project listed twice, or an unknown project role",
    ),
    403: errorResponse(
      "Missing invitation:create, neither project:share nor the lead of a listed project, or an invitation role above your own",
    ),
    404: errorResponse(
      `${INVITATION_NOT_FOUND}, or a project outside the workspace or that you can't see`,
    ),
    409: errorResponse("The invitation is no longer pending"),
  },
});

const invitation = apiRouter()
  .openapi(getPendingRoute, async (c) => {
    const user = c.get("user");
    if (!user?.emailVerified) {
      return c.json([], 200);
    }
    return c.json(await getUserPendingInvitations(c.get("userEmail")), 200);
  })
  .openapi(getInvitationRoute, async (c) =>
    c.json(await getInvitationDetailsController(c.req.valid("param").id), 200),
  )
  .openapi(updateInvitationRoleRoute, async (c) => {
    const updated = await updateInvitationRole({
      invitationId: c.req.valid("param").id,
      role: c.req.valid("json").role,
      userId: c.get("userId"),
      instanceAdmin: await isInstanceAdmin(c),
    });
    return c.json(updated, 200);
  })
  .openapi(setInvitationProjectsRoute, async (c) => {
    const projects = await setInvitationProjects(c, {
      invitationId: c.req.valid("param").id,
      projects: c.req.valid("json").projects,
      instanceAdmin: await isInstanceAdmin(c),
    });
    return c.json({ projects }, 200);
  });

export default invitation;
