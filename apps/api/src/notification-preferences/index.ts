import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import {
  deletePushSubscription,
  getPushStatus,
  savePushSubscription,
} from "./push";
import { notificationPreferenceSchema, pushStatusSchema } from "./response";
import {
  pushSubscriptionIdParam,
  savePushSubscriptionBody,
  updatePreferencesBody,
  upsertWorkspaceRuleBody,
  workspaceIdParam,
} from "./schema";
import {
  deleteWorkspaceRule,
  getNotificationPreferences,
  updateNotificationPreferences,
  upsertWorkspaceRule,
} from "./service";

const preferencesResponse = (description: string) =>
  jsonResponse(description, notificationPreferenceSchema);

const getPreferencesRoute = createRoute({
  method: "get",
  operationId: "getNotificationPreferences",
  path: "/",
  tags: ["Notification Preferences"],
  summary: "Get notification preferences",
  description:
    "Get how the current user is notified, globally and per workspace. Configured secrets are reported as booleans plus a masked preview, never in full.",
  responses: {
    200: preferencesResponse("Notification preferences"),
  },
});

const updatePreferencesRoute = createRoute({
  method: "put",
  operationId: "updateNotificationPreferences",
  path: "/",
  tags: ["Notification Preferences"],
  summary: "Update notification preferences",
  description:
    "Update the global delivery settings. Omitted fields are left unchanged; a URL, topic or secret sent as null or an empty string is cleared (a channel that stays enabled still needs its destination). Secrets are stored encrypted, which needs NOTIFICATION_SECRET_ENCRYPTION_KEY on the instance.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updatePreferencesBody } },
    },
  },
  responses: {
    200: preferencesResponse("The updated preferences"),
    400: errorResponse(
      "Invalid request, or an enabled channel without its destination",
    ),
    503: errorResponse(
      "A secret was sent, but NOTIFICATION_SECRET_ENCRYPTION_KEY is not set on this instance",
    ),
  },
});

const upsertWorkspaceRuleRoute = createRoute({
  method: "put",
  operationId: "upsertNotificationPreferenceWorkspaceRule",
  path: "/workspaces/{workspaceId}",
  tags: ["Notification Preferences"],
  summary: "Upsert workspace rule",
  description:
    "Create or replace the notification rule for one workspace, overriding the global settings there.",
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: upsertWorkspaceRuleBody } },
    },
  },
  responses: {
    200: preferencesResponse("The updated preferences"),
    400: errorResponse("Invalid request"),
    403: errorResponse("No access to the workspace"),
  },
});

const deleteWorkspaceRuleRoute = createRoute({
  method: "delete",
  operationId: "deleteNotificationPreferenceWorkspaceRule",
  path: "/workspaces/{workspaceId}",
  tags: ["Notification Preferences"],
  summary: "Delete workspace rule",
  description:
    "Remove a workspace's rule so the workspace falls back to the global settings.",
  request: { params: workspaceIdParam },
  responses: {
    200: preferencesResponse("The updated preferences"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace rule not found"),
  },
});

const pushStatusResponse = (description: string) =>
  jsonResponse(description, pushStatusSchema);

const getPushStatusRoute = createRoute({
  method: "get",
  operationId: "getPushStatus",
  path: "/push",
  tags: ["Notification Preferences"],
  summary: "Get web push status",
  description:
    "Whether this instance has push set up, and which of your devices receive it. Needs a user session: API keys are refused.",
  middleware: [requireUserSession],
  responses: {
    200: pushStatusResponse("Push status and your devices"),
    403: errorResponse("A user session is required"),
  },
});

const savePushSubscriptionRoute = createRoute({
  method: "put",
  operationId: "savePushSubscription",
  path: "/push/subscriptions",
  tags: ["Notification Preferences"],
  summary: "Turn on web push for a device",
  description:
    "Save a browser's push subscription for the current user. A device already saved under another account moves to this one; the oldest device is removed past ten. Your notification types and workspace rules decide what is sent to it.",
  middleware: [requireUserSession],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: savePushSubscriptionBody } },
    },
  },
  responses: {
    200: pushStatusResponse("Push status and your devices"),
    400: errorResponse("Invalid subscription"),
    403: errorResponse("A user session is required"),
    409: errorResponse("Push is not set up on this instance"),
  },
});

const deletePushSubscriptionRoute = createRoute({
  method: "delete",
  operationId: "deletePushSubscription",
  path: "/push/subscriptions/{id}",
  tags: ["Notification Preferences"],
  summary: "Turn off web push for a device",
  description: "Stop sending push to one of your devices.",
  middleware: [requireUserSession],
  request: { params: pushSubscriptionIdParam },
  responses: {
    200: pushStatusResponse("Push status and your remaining devices"),
    403: errorResponse("A user session is required"),
    404: errorResponse("Device not found"),
  },
});

const notificationPreferences = apiRouter()
  .openapi(getPushStatusRoute, async (c) =>
    c.json(await getPushStatus(c.get("userId")), 200),
  )
  .openapi(savePushSubscriptionRoute, async (c) =>
    c.json(
      await savePushSubscription(
        c.get("userId"),
        c.req.valid("json"),
        c.req.header("user-agent"),
      ),
      200,
    ),
  )
  .openapi(deletePushSubscriptionRoute, async (c) =>
    c.json(
      await deletePushSubscription(c.get("userId"), c.req.valid("param").id),
      200,
    ),
  )
  .openapi(getPreferencesRoute, async (c) =>
    c.json(
      await getNotificationPreferences(
        c.get("userId"),
        c.get("userEmail") || null,
      ),
      200,
    ),
  )
  .openapi(updatePreferencesRoute, async (c) =>
    c.json(
      await updateNotificationPreferences(
        c.get("userId"),
        c.get("userEmail") || null,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(upsertWorkspaceRuleRoute, async (c) =>
    c.json(
      await upsertWorkspaceRule(
        c.get("userId"),
        c.req.valid("param").workspaceId,
        c.get("userEmail") || null,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(deleteWorkspaceRuleRoute, async (c) =>
    c.json(
      await deleteWorkspaceRule(
        c.get("userId"),
        c.req.valid("param").workspaceId,
        c.get("userEmail") || null,
      ),
      200,
    ),
  );

export default notificationPreferences;
