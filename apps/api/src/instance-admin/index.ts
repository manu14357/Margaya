import { getInstanceSettings } from "../instance-settings/snapshot";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setPublicBoardInstanceState } from "../public-board/instance-state";
import { requireUserSession } from "../utils/require-user-session";
import {
  addInstanceAdmin,
  listInstanceAdmins,
  removeInstanceAdmin,
} from "./controllers/admins";
import {
  listInstancePublicBoards,
  listInstanceWorkspaces,
} from "./controllers/lists";
import { getInstanceOverview } from "./controllers/overview";
import {
  getInstanceSettingsView,
  updateInstanceSettings,
} from "./controllers/settings";
import { sendInstanceTestEmail } from "./controllers/test-email";
import { requireInstanceAdmin } from "./middleware";
import {
  instanceAdminSchema,
  instanceOverviewSchema,
  instancePublicBoardPageSchema,
  instanceSettingsSchema,
  instanceWorkspacePageSchema,
  removedInstanceAdminSchema,
  smtpTestResultSchema,
} from "./response";
import {
  addInstanceAdminBody,
  instanceAdminParam,
  listInstancePublicBoardsQuery,
  listInstanceWorkspacesQuery,
  sendInstanceTestEmailBody,
  updateInstanceSettingsBody,
} from "./schema";

// The instance admin area (B12b). Every route needs a signed-in user session
// (API keys are refused) and re-reads the caller's role from the database.

// Public boards read the instance switches and guest rules from the
// effective settings.
setPublicBoardInstanceState(() => {
  const { effective, derived } = getInstanceSettings();
  return {
    publicBoards: effective.publicBoards.enabled,
    participation: effective.publicBoards.participation,
    guestAccessActive: derived.guestAccessActive,
    instanceName: effective.instanceName,
    signUpAvailable: !effective.inviteOnly && effective.emailSignUp,
  };
});

const TAGS = ["Instance admin"];

const ADMIN_NOTE =
  " Instance admins only, with a signed-in session: API keys are refused.";
const forbidden = errorResponse(
  "Not an instance admin, or an API key instead of a user session",
);
const tooOften = errorResponse(
  "Too many requests; retry after the Retry-After seconds",
);
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const getOverviewRoute = createRoute({
  method: "get",
  operationId: "getInstanceOverview",
  path: "/overview",
  tags: TAGS,
  summary: "Get instance overview",
  description: `Version, account, workspace, project and public board counts, and which server services are configured (never their values).${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The overview", instanceOverviewSchema),
    403: forbidden,
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getInstanceSettings",
  path: "/settings",
  tags: TAGS,
  summary: "Get instance settings",
  description: `Every catalog setting with its effective value, where it comes from (environment, database or default) and whether the environment locks it. Secret values are never returned: only whether one is configured or unreadable.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The settings", instanceSettingsSchema),
    403: forbidden,
  },
});

const updateSettingsRoute = createRoute({
  method: "patch",
  operationId: "updateInstanceSettings",
  path: "/settings",
  tags: TAGS,
  summary: "Update instance settings",
  description: `Save 1 to 40 settings at once; null clears a saved value. Precedence: MARGAYA_LOCK_INSTANCE_SETTINGS=true makes everything read-only; a set environment variable locks its setting (credentials lock as a group); then the saved value; then the default. Refuses a change that would leave no working sign-in method. Takes effect at once on this server and within 10 seconds on others. Limited to 30 writes a minute per admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { body: json(updateInstanceSettingsBody) },
  responses: {
    200: jsonResponse("The settings after the change", instanceSettingsSchema),
    400: errorResponse("Unknown key or invalid value"),
    403: forbidden,
    409: errorResponse(
      "The settings are locked, the key is set by an environment variable, or the change would remove the last sign-in method",
    ),
    429: tooOften,
  },
});

const listWorkspacesRoute = createRoute({
  method: "get",
  operationId: "listInstanceWorkspaces",
  path: "/workspaces",
  tags: TAGS,
  summary: "List instance workspaces",
  description: `Every workspace on the instance, newest first, with its owner, member count and project count. Search matches the name or slug; page with nextCursor.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: listInstanceWorkspacesQuery },
  responses: {
    200: jsonResponse("A page of workspaces", instanceWorkspacePageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const sendTestEmailRoute = createRoute({
  method: "post",
  operationId: "sendInstanceTestEmail",
  path: "/email/test",
  tags: TAGS,
  summary: "Send a test email",
  description: `Verify the effective SMTP settings and send a short message (to the caller by default). Failures answer 200 with sent false and a curated, classified message; server text is never returned. Limited to 5 a minute per admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { body: json(sendInstanceTestEmailBody) },
  responses: {
    200: jsonResponse("The test result", smtpTestResultSchema),
    400: errorResponse("Invalid recipient"),
    403: forbidden,
    409: errorResponse("Email is not set up"),
    429: tooOften,
  },
});

const listAdminsRoute = createRoute({
  method: "get",
  operationId: "listInstanceAdmins",
  path: "/admins",
  tags: TAGS,
  summary: "List instance admins",
  description: `Every instance admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The admins", instanceAdminSchema.array()),
    403: forbidden,
  },
});

const addAdminRoute = createRoute({
  method: "post",
  operationId: "addInstanceAdmin",
  path: "/admins",
  tags: TAGS,
  summary: "Add an instance admin",
  description: `Make an existing account an instance admin by email. Guests and banned accounts can't be admins. Adding an existing admin changes nothing.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { body: json(addInstanceAdminBody) },
  responses: {
    200: jsonResponse("The admin", instanceAdminSchema),
    400: errorResponse("A guest or banned account"),
    403: forbidden,
    404: errorResponse("No account uses this email"),
    429: tooOften,
  },
});

const removeAdminRoute = createRoute({
  method: "delete",
  operationId: "removeInstanceAdmin",
  path: "/admins/{userId}",
  tags: TAGS,
  summary: "Remove an instance admin",
  description: `Make an instance admin a regular account again. The last active admin can't be removed.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { params: instanceAdminParam },
  responses: {
    200: jsonResponse("The removed admin", removedInstanceAdminSchema),
    403: forbidden,
    404: errorResponse("This person isn't an instance admin"),
    409: errorResponse("There must be at least one instance admin"),
    429: tooOften,
  },
});

const listPublicBoardsRoute = createRoute({
  method: "get",
  operationId: "listInstancePublicBoards",
  path: "/public-boards",
  tags: TAGS,
  summary: "List published boards",
  description: `Every published board on the instance, newest first, with its participation features. Search matches the project or workspace name. Unpublish through the project's publication routes.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: listInstancePublicBoardsQuery },
  responses: {
    200: jsonResponse("A page of boards", instancePublicBoardPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const instanceAdmin = apiRouter()
  .openapi(getOverviewRoute, async (c) =>
    c.json(await getInstanceOverview(), 200),
  )
  .openapi(getSettingsRoute, async (c) =>
    c.json(await getInstanceSettingsView(), 200),
  )
  .openapi(updateSettingsRoute, async (c) =>
    c.json(
      await updateInstanceSettings(c.req.valid("json").values, c.get("userId")),
      200,
    ),
  )
  .openapi(listWorkspacesRoute, async (c) =>
    c.json(await listInstanceWorkspaces(c.req.valid("query")), 200),
  )
  .openapi(sendTestEmailRoute, async (c) =>
    c.json(
      await sendInstanceTestEmail({
        to: c.req.valid("json").to,
        callerEmail: c.get("userEmail"),
        callerId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(listAdminsRoute, async (c) =>
    c.json(await listInstanceAdmins(c.get("userId")), 200),
  )
  .openapi(addAdminRoute, async (c) =>
    c.json(
      await addInstanceAdmin(c.req.valid("json").email, c.get("userId")),
      200,
    ),
  )
  .openapi(removeAdminRoute, async (c) =>
    c.json(
      await removeInstanceAdmin(c.req.valid("param").userId, c.get("userId")),
      200,
    ),
  )
  .openapi(listPublicBoardsRoute, async (c) =>
    c.json(await listInstancePublicBoards(c.req.valid("query")), 200),
  );

export default instanceAdmin;
