import { HTTPException } from "hono/http-exception";
import { buildDesktopNotification } from "../notification-preferences/delivery";
import { apiRouter } from "../openapi";
import clearNotifications from "./controllers/clear-notifications";
import createNotification from "./controllers/create-notification";
import getInbox from "./controllers/get-inbox";
import getInboxCounts from "./controllers/get-inbox-counts";
import getNotifications from "./controllers/get-notifications";
import markAllNotificationsAsRead from "./controllers/mark-all-notifications-as-read";
import updateNotificationState from "./controllers/update-notification-state";
import { parseInboxTypes } from "./inbox";
import {
  archiveRoute,
  clearAllRoute,
  createNotificationRoute,
  desktopNotificationRoute,
  inboxCountsRoute,
  inboxRoute,
  listNotificationsRoute,
  markAllAsReadRoute,
  markAsReadRoute,
  markAsUnreadRoute,
  snoozeRoute,
  unarchiveRoute,
  unsnoozeRoute,
} from "./routes";
// Event-driven notifications and the task-deletion cleanup register once,
// with the router.
import "./subscribers";
import "./cleanup";

// Literal paths come before the parameterized /{id}/... routes.
const notification = apiRouter()
  .openapi(listNotificationsRoute, async (c) =>
    c.json(await getNotifications(c.get("userId")), 200),
  )
  .openapi(createNotificationRoute, async (c) => {
    const {
      title,
      message,
      type,
      eventData,
      relatedEntityId,
      relatedEntityType,
    } = c.req.valid("json");
    return c.json(
      await createNotification({
        userId: c.get("userId"),
        title,
        content: message,
        type,
        eventData,
        resourceId: relatedEntityId,
        resourceType: relatedEntityType,
      }),
      200,
    );
  })
  .openapi(inboxRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await getInbox({
        userId: c.get("userId"),
        workspaceId: query.workspaceId,
        tab: query.tab ?? "all",
        view: query.view ?? "inbox",
        unread: query.unread === "true",
        types: parseInboxTypes(query.types) ?? [],
        limit: query.limit ?? 50,
        cursor: query.cursor,
      }),
      200,
    );
  })
  .openapi(inboxCountsRoute, async (c) =>
    c.json(
      await getInboxCounts(c.get("userId"), c.req.valid("query").workspaceId),
      200,
    ),
  )
  .openapi(markAllAsReadRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await markAllNotificationsAsRead(
        c.get("userId"),
        query.workspaceId
          ? {
              workspaceId: query.workspaceId,
              tab: query.tab ?? "all",
              view: query.view ?? "inbox",
              types: parseInboxTypes(query.types) ?? [],
            }
          : undefined,
      ),
      200,
    );
  })
  .openapi(clearAllRoute, async (c) =>
    c.json(
      await clearNotifications(
        c.get("userId"),
        c.req.valid("query").workspaceId,
      ),
      200,
    ),
  )
  .openapi(markAsReadRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "read",
      }),
      200,
    ),
  )
  .openapi(markAsUnreadRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "unread",
      }),
      200,
    ),
  )
  .openapi(archiveRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "archive",
      }),
      200,
    ),
  )
  .openapi(unarchiveRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "unarchive",
      }),
      200,
    ),
  )
  .openapi(snoozeRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "snooze",
        until: new Date(c.req.valid("json").until),
      }),
      200,
    ),
  )
  .openapi(unsnoozeRoute, async (c) =>
    c.json(
      await updateNotificationState(c.req.valid("param").id, c.get("userId"), {
        action: "unsnooze",
      }),
      200,
    ),
  )
  .openapi(desktopNotificationRoute, async (c) => {
    const alert = await buildDesktopNotification(
      c.req.valid("param").id,
      c.get("userId"),
      c.req.valid("query").timeZone,
    );
    if (!alert) {
      throw new HTTPException(404, { message: "Notification not found" });
    }
    return c.json(alert, 200);
  });

export default notification;
