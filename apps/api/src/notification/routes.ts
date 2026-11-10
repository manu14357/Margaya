import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  bulkResultSchema,
  desktopNotificationSchema,
  inboxCountsSchema,
  inboxPageSchema,
  notificationListSchema,
  notificationSchema,
} from "./response";
import {
  clearAllQuery,
  createNotificationBody,
  desktopNotificationQuery,
  inboxCountsQuery,
  inboxQuery,
  markAllReadQuery,
  notificationParam,
  snoozeBody,
} from "./schema";

// Route definitions of the notification router. Every route acts only on
// the caller's own notifications.

export const listNotificationsRoute = createRoute({
  method: "get",
  operationId: "listNotifications",
  path: "/",
  tags: ["Notifications"],
  summary: "List notifications",
  description:
    "Get the current user's 50 newest notifications across every workspace, read and unread, archived and snoozed included. The workspace inbox is `GET /notification/inbox`.",
  responses: {
    200: jsonResponse("List of notifications", notificationListSchema),
  },
});

export const createNotificationRoute = createRoute({
  method: "post",
  operationId: "createNotification",
  path: "/",
  tags: ["Notifications"],
  summary: "Create notification",
  description:
    "Create a notification for the current user. Most notifications are raised by the server from task and workspace events; this exists for integrations. Its workspace is derived from the related task or workspace; without one it shows in every workspace's inbox. Returns null when the user has turned off this notification category in their preferences.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createNotificationBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The created notification, or null when the user has muted this notification type",
      notificationSchema.nullable(),
    ),
    400: errorResponse("Invalid request"),
  },
});

export const inboxRoute = createRoute({
  method: "get",
  operationId: "listInboxNotifications",
  path: "/inbox",
  tags: ["Notifications"],
  summary: "List inbox",
  description:
    "One page of the current user's inbox in a workspace, with notifications that belong to no workspace. Views: inbox (neither archived nor currently snoozed; newest first, a resurfaced snooze counts from when it ended), snoozed (soonest to return first) and archived (latest first). Tabs, unread-only and the any-of type filters narrow it. Keyset paging: pass nextCursor back as cursor with the same view.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: inboxQuery },
  responses: {
    200: jsonResponse("One page of inbox notifications", inboxPageSchema),
    400: errorResponse(
      "Invalid tab, view, types or limit, a malformed cursor, or one from another view",
    ),
    403: errorResponse("Not a member of the workspace"),
  },
});

export const inboxCountsRoute = createRoute({
  method: "get",
  operationId: "getInboxCounts",
  path: "/counts",
  tags: ["Notifications"],
  summary: "Get inbox counts",
  description:
    "Unread counts of the workspace's Inbox view (neither archived nor snoozed): every type, and mentions alone.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: inboxCountsQuery },
  responses: {
    200: jsonResponse("Unread counts", inboxCountsSchema),
    400: errorResponse("Missing workspaceId"),
    403: errorResponse("Not a member of the workspace"),
  },
});

export const markAllAsReadRoute = createRoute({
  method: "patch",
  operationId: "markAllNotificationsAsRead",
  path: "/read-all",
  tags: ["Notifications"],
  summary: "Mark all read",
  description:
    "Mark notifications of the current user as read: every one of them, or, with workspaceId, only those the inbox shows for that workspace, tab, view and type filters.",
  request: { query: markAllReadQuery },
  responses: {
    200: jsonResponse("Notifications marked as read", bulkResultSchema),
    400: errorResponse("Invalid tab, view or types"),
  },
});

export const clearAllRoute = createRoute({
  method: "delete",
  operationId: "clearAllNotifications",
  path: "/clear-all",
  tags: ["Notifications"],
  summary: "Clear all",
  description:
    "Permanently delete notifications of the current user: all of them, or, with workspaceId, only that workspace's. This cannot be undone.",
  request: { query: clearAllQuery },
  responses: {
    200: jsonResponse("Notifications cleared", bulkResultSchema),
  },
});

// Generic over the action so each path stays a literal ("/{id}/read"): a
// widened `/{id}/${string}` would merge with the snooze route in the typed
// client and drop its JSON body.
function stateRoute<Action extends string>(input: {
  action: Action;
  operationId: string;
  summary: string;
  description: string;
}) {
  return createRoute({
    method: "patch",
    operationId: input.operationId,
    path: `/{id}/${input.action}` as const,
    tags: ["Notifications"],
    summary: input.summary,
    description: `${input.description} Scoped to the current user, so another user's notification is not found. Repeating it changes nothing.`,
    request: { params: notificationParam },
    responses: {
      200: jsonResponse("The notification", notificationSchema),
      404: errorResponse("Notification not found"),
    },
  });
}

export const markAsReadRoute = stateRoute({
  action: "read",
  operationId: "markNotificationAsRead",
  summary: "Mark notification read",
  description: "Mark one notification as read.",
});

export const markAsUnreadRoute = stateRoute({
  action: "unread",
  operationId: "markNotificationAsUnread",
  summary: "Mark notification unread",
  description: "Mark one notification as unread.",
});

export const archiveRoute = stateRoute({
  action: "archive",
  operationId: "archiveNotification",
  summary: "Archive notification",
  description:
    "Move one notification to the Archived view. Archiving clears a snooze.",
});

export const unarchiveRoute = stateRoute({
  action: "unarchive",
  operationId: "unarchiveNotification",
  summary: "Unarchive notification",
  description: "Move one archived notification back to the inbox.",
});

export const unsnoozeRoute = stateRoute({
  action: "unsnooze",
  operationId: "unsnoozeNotification",
  summary: "Unsnooze notification",
  description:
    "End a snooze now: the notification returns to the top of the inbox with its read state unchanged.",
});

export const snoozeRoute = createRoute({
  method: "patch",
  operationId: "snoozeNotification",
  path: "/{id}/snooze",
  tags: ["Notifications"],
  summary: "Snooze notification",
  description:
    "Hide one notification from the inbox until `until`, when it returns unread at the top (without being delivered again). Snoozing clears an archive; a new time replaces the old one. Scoped to the current user.",
  request: {
    params: notificationParam,
    body: {
      required: true,
      content: { "application/json": { schema: snoozeBody } },
    },
  },
  responses: {
    200: jsonResponse("The snoozed notification", notificationSchema),
    400: errorResponse(
      "Invalid date-time, less than a minute ahead, or more than a year ahead",
    ),
    404: errorResponse("Notification not found"),
  },
});

export const desktopNotificationRoute = createRoute({
  method: "get",
  operationId: "getDesktopNotification",
  path: "/{id}/desktop",
  tags: ["Notifications"],
  summary: "Get desktop alert",
  description:
    "The text Margaya Desktop shows for one of the current user's notifications, after the user socket's NOTIFICATION_CREATED hint names it. The same title and line as Web Push, in the user's language, with an absolute link into the web app. Works with the session cookie or a bearer session token.",
  request: { params: notificationParam, query: desktopNotificationQuery },
  responses: {
    200: jsonResponse("The alert", desktopNotificationSchema),
    404: errorResponse(
      "No such notification, it belongs to someone else, or its task or page is no longer visible to the user",
    ),
  },
});
