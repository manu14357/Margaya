import { getInstanceSettings } from "../instance-settings/snapshot";
import { getUpdateStatus } from "../observability/update-check";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setPublicBoardInstanceState } from "../public-board/instance-state";
import { enforceRateLimits } from "../utils/rate-limit";
import { requireUserSession } from "../utils/require-user-session";
import { listInstanceAudit } from "./audit";
import {
  addInstanceAdmin,
  listInstanceAdmins,
  removeInstanceAdmin,
} from "./controllers/admins";
import { listRecentDeliveryFailures } from "./controllers/failures";
import { getInstanceHealth } from "./controllers/health";
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
import {
  banInstanceUser,
  getInstanceUser,
  listInstanceUsers,
  resetInstanceUserPassword,
  resetInstanceUserTwoFactor,
  revokeInstanceUserSessions,
  unbanInstanceUser,
} from "./controllers/users";
import { healthLimiter } from "./limits";
import { requireInstanceAdmin } from "./middleware";
import { confirmAdminPassword, requireRecentAuth } from "./reauth";
import {
  instanceAdminSchema,
  instanceAuditPageSchema,
  instanceDeliveryFailuresSchema,
  instanceHealthSchema,
  instanceOverviewSchema,
  instancePublicBoardPageSchema,
  instanceReauthRequiredSchema,
  instanceReauthResultSchema,
  instanceSettingsSchema,
  instanceUpdateStatusSchema,
  instanceUserActionSchema,
  instanceUserDetailSchema,
  instanceUserPageSchema,
  instanceWorkspacePageSchema,
  removedInstanceAdminSchema,
  smtpTestResultSchema,
} from "./response";
import {
  addInstanceAdminBody,
  banInstanceUserBody,
  confirmInstanceAdminBody,
  instanceAdminParam,
  instanceUserParam,
  listInstanceAuditQuery,
  listInstancePublicBoardsQuery,
  listInstanceUsersQuery,
  listInstanceWorkspacesQuery,
  resetInstanceUserPasswordBody,
  sendInstanceTestEmailBody,
  updateInstanceSettingsBody,
} from "./schema";

// The instance admin area (B12b). Every route needs a signed-in user session
// (API keys are refused) and re-reads the caller's role from the database.
// Changes also need a recent sign-in (reauth.ts) and land in the instance
// audit trail (audit.ts).

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
const REAUTH_NOTE =
  " Needs a recent sign-in: a session opened in the last 10 minutes, or a password confirmed through POST /instance-admin/reauth; otherwise 403 with code REAUTH_REQUIRED.";
const forbidden = errorResponse(
  "Not an instance admin, or an API key instead of a user session",
);
const forbiddenOrStale = {
  description:
    "Not an instance admin, an API key instead of a user session, or no recent sign-in (JSON with code REAUTH_REQUIRED)",
  content: {
    "text/plain": { schema: z.string() },
    "application/json": { schema: instanceReauthRequiredSchema },
  },
};
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
  description: `Save 1 to 40 settings at once; null clears a saved value. Precedence: MARGAYA_LOCK_INSTANCE_SETTINGS=true makes everything read-only; a set environment variable locks its setting (credentials lock as a group); then the saved value; then the default. Refuses a change that would leave no working sign-in method, or that requires two-factor while the caller would have to set it up first or, with no password and no working sign-in provider, could only sign in with the email links and codes it turns off. Takes effect at once on this server and within 10 seconds on others. Limited to 30 writes a minute per admin.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { body: json(updateInstanceSettingsBody) },
  responses: {
    200: jsonResponse("The settings after the change", instanceSettingsSchema),
    400: errorResponse("Unknown key or invalid value"),
    403: forbiddenOrStale,
    409: errorResponse(
      "The settings are locked, the key is set by an environment variable, the change would remove the last sign-in method, or it requires two-factor before the caller has set it up or while the caller has no password and no working sign-in provider",
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
  description: `Every workspace on the instance, newest first, with its owner, member count and project count. Search matches the name or slug; pendingDeletion=true keeps the workspaces scheduled for deletion (deletionDueAt is set); page with nextCursor.${ADMIN_NOTE}`,
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
  description: `Make an existing account an instance admin by email. Guests and banned accounts can't be admins. Adding an existing admin changes nothing.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { body: json(addInstanceAdminBody) },
  responses: {
    200: jsonResponse("The admin", instanceAdminSchema),
    400: errorResponse("A guest or banned account"),
    403: forbiddenOrStale,
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
  description: `Make an instance admin a regular account again. The last active admin can't be removed.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: instanceAdminParam },
  responses: {
    200: jsonResponse("The removed admin", removedInstanceAdminSchema),
    403: forbiddenOrStale,
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

const reauthRoute = createRoute({
  method: "post",
  operationId: "confirmInstanceAdmin",
  path: "/reauth",
  tags: TAGS,
  summary: "Confirm your password",
  description: `Confirm the caller's password so this session may change instance settings and admins for the next 10 minutes. Accounts without a password sign in again instead. Limited to 5 attempts a minute per admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { body: json(confirmInstanceAdminBody) },
  responses: {
    200: jsonResponse("The confirmation window", instanceReauthResultSchema),
    400: errorResponse("The account has no password"),
    403: {
      description:
        "Not an instance admin, an API key, or a wrong password (JSON with code INVALID_PASSWORD)",
      content: {
        "text/plain": { schema: z.string() },
        "application/json": {
          schema: z.object({ code: z.string(), message: z.string() }),
        },
      },
    },
    429: tooOften,
  },
});

const listAuditRoute = createRoute({
  method: "get",
  operationId: "listInstanceAuditLog",
  path: "/audit-log",
  tags: TAGS,
  summary: "List the instance audit trail",
  description: `Instance-level changes, newest first: settings saved (keys only, never values), admins added or removed, password confirmations, account actions through the admin endpoints, and recovery CLI runs. Page with nextCursor.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: listInstanceAuditQuery },
  responses: {
    200: jsonResponse("A page of entries", instanceAuditPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const listDeliveryFailuresRoute = createRoute({
  method: "get",
  operationId: "listInstanceDeliveryFailures",
  path: "/delivery-failures",
  tags: TAGS,
  summary: "List recent delivery failures",
  description: `Workspace webhook deliveries that used up their retries in the last 7 days, newest first, at most 20. It never returns the destination URL, request body or response.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The failures", instanceDeliveryFailuresSchema),
    403: forbidden,
  },
});

const getHealthRoute = createRoute({
  method: "get",
  operationId: "getInstanceHealth",
  path: "/health",
  tags: TAGS,
  summary: "Get instance health",
  description: `Version, uptime and the migration state; database, Redis, storage, email (an SMTP sign-in without sending) and AI checks, each with a 5-second limit; scheduled job runs, recent failures, queue backlogs and open sockets. Jobs, failures and sockets are those of the instance that answered, since it started. Answers carry states and short codes, never hosts, paths or server text. Limited to 20 a minute per admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The health report", instanceHealthSchema),
    403: forbidden,
    429: tooOften,
  },
});

const getUpdateStatusRoute = createRoute({
  method: "get",
  operationId: "getInstanceUpdateStatus",
  path: "/update-status",
  tags: TAGS,
  summary: "Get the update notice",
  description: `Whether a newer release than the running version is out. Off by default: with the general.updateCheck setting (MARGAYA_UPDATE_CHECK) on, the server reads the public release feed at most once a day, sending nothing about the instance; otherwise enabled is false and nothing is fetched.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  responses: {
    200: jsonResponse("The update status", instanceUpdateStatusSchema),
    403: forbidden,
  },
});

const listUsersRoute = createRoute({
  method: "get",
  operationId: "listInstanceUsers",
  path: "/users",
  tags: TAGS,
  summary: "List instance users",
  description: `Every account on the instance except guests, newest first: role, ban state, two-factor, workspace count and last activity. Search matches the name or email; status narrows to admins or banned accounts. Page with nextCursor.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { query: listInstanceUsersQuery },
  responses: {
    200: jsonResponse("A page of users", instanceUserPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const getUserRoute = createRoute({
  method: "get",
  operationId: "getInstanceUser",
  path: "/users/{userId}",
  tags: TAGS,
  summary: "Get an instance user",
  description: `One account's workspaces (with its role in each), active session count and whether it has a password.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin],
  request: { params: instanceUserParam },
  responses: {
    200: jsonResponse("The user", instanceUserDetailSchema),
    403: forbidden,
    404: errorResponse("No such user"),
  },
});

const banUserRoute = createRoute({
  method: "post",
  operationId: "banInstanceUser",
  path: "/users/{userId}/ban",
  tags: TAGS,
  summary: "Ban a user",
  description: `Ban an account, for good or for a number of days, and sign it out everywhere. You can't ban yourself or the last instance admin.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: instanceUserParam, body: json(banInstanceUserBody) },
  responses: {
    200: jsonResponse("Banned", instanceUserActionSchema),
    400: errorResponse("Banning yourself"),
    403: forbiddenOrStale,
    404: errorResponse("No such user"),
    409: errorResponse("There must be at least one instance admin"),
    429: tooOften,
  },
});

const unbanUserRoute = createRoute({
  method: "post",
  operationId: "unbanInstanceUser",
  path: "/users/{userId}/unban",
  tags: TAGS,
  summary: "Unban a user",
  description: `Lift a ban so the account can sign in again.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: instanceUserParam },
  responses: {
    200: jsonResponse("Unbanned", instanceUserActionSchema),
    403: forbiddenOrStale,
    404: errorResponse("No such user"),
    429: tooOften,
  },
});

const revokeUserSessionsRoute = createRoute({
  method: "post",
  operationId: "revokeInstanceUserSessions",
  path: "/users/{userId}/revoke-sessions",
  tags: TAGS,
  summary: "Sign a user out everywhere",
  description: `End every session of an account. Its API keys keep working; the owner revokes those, or banning the account stops them. Use your own account settings for your sessions.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: instanceUserParam },
  responses: {
    200: jsonResponse("Sessions ended", instanceUserActionSchema),
    400: errorResponse("Your own account"),
    403: forbiddenOrStale,
    404: errorResponse("No such user"),
    429: tooOften,
  },
});

const resetUserTwoFactorRoute = createRoute({
  method: "post",
  operationId: "resetInstanceUserTwoFactor",
  path: "/users/{userId}/reset-two-factor",
  tags: TAGS,
  summary: "Reset a user's two-factor",
  description: `For someone who lost their authenticator and recovery codes: remove their two-factor and sign them out everywhere. They sign in with just their password and set it up again; if the server requires two-factor, they must before anything else. Changes nothing when two-factor is off. Use the recovery CLI for your own account.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: { params: instanceUserParam },
  responses: {
    200: jsonResponse("Reset", instanceUserActionSchema),
    400: errorResponse("Your own account"),
    403: forbiddenOrStale,
    404: errorResponse("No such user"),
    429: tooOften,
  },
});

const resetUserPasswordRoute = createRoute({
  method: "post",
  operationId: "resetInstanceUserPassword",
  path: "/users/{userId}/reset-password",
  tags: TAGS,
  summary: "Reset a user's password",
  description: `Without a password, email the account a reset link (needs outgoing email). With one, set it now (the password rules apply) and sign the account out everywhere. Neither returns the password.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin, requireRecentAuth],
  request: {
    params: instanceUserParam,
    body: json(resetInstanceUserPasswordBody),
  },
  responses: {
    200: jsonResponse("Reset", instanceUserActionSchema),
    400: errorResponse("The password breaks the password rules"),
    403: forbiddenOrStale,
    404: errorResponse("No such user"),
    409: errorResponse("Email is not set up"),
    429: tooOften,
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
        // The session user carries the `locale` additional field.
        callerLocale: (c.get("user") as { locale?: string | null } | null)
          ?.locale,
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
  )
  .openapi(reauthRoute, async (c) =>
    c.json(
      await confirmAdminPassword({
        userId: c.get("userId"),
        sessionId: c.get("session")?.id ?? "",
        password: c.req.valid("json").password,
      }),
      200,
    ),
  )
  .openapi(listUsersRoute, async (c) =>
    c.json(await listInstanceUsers(c.req.valid("query")), 200),
  )
  .openapi(getUserRoute, async (c) =>
    c.json(await getInstanceUser(c.req.valid("param").userId), 200),
  )
  .openapi(banUserRoute, async (c) =>
    c.json(
      await banInstanceUser(
        c.req.valid("param").userId,
        c.get("userId"),
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(unbanUserRoute, async (c) =>
    c.json(
      await unbanInstanceUser(c.req.valid("param").userId, c.get("userId")),
      200,
    ),
  )
  .openapi(revokeUserSessionsRoute, async (c) =>
    c.json(
      await revokeInstanceUserSessions(
        c.req.valid("param").userId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(resetUserTwoFactorRoute, async (c) =>
    c.json(
      await resetInstanceUserTwoFactor(
        c.req.valid("param").userId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(resetUserPasswordRoute, async (c) =>
    c.json(
      await resetInstanceUserPassword(
        c.req.valid("param").userId,
        c.get("userId"),
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(listAuditRoute, async (c) => {
    const { cursor, limit, action } = c.req.valid("query");
    return c.json(
      await listInstanceAudit({
        cursor,
        limit,
        action: action
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }),
      200,
    );
  })
  .openapi(listDeliveryFailuresRoute, async (c) =>
    c.json(await listRecentDeliveryFailures(), 200),
  )
  .openapi(getHealthRoute, async (c) => {
    await enforceRateLimits([[healthLimiter, c.get("userId")]]);
    return c.json(await getInstanceHealth(), 200);
  })
  .openapi(getUpdateStatusRoute, async (c) =>
    c.json(await getUpdateStatus(), 200),
  );

export default instanceAdmin;
