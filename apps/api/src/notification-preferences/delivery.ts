import { createHmac } from "node:crypto";
import {
  emailCopy,
  resolveEmailLocale,
  sendNotificationEmail,
} from "@margaya/email";
import { and, eq, isNull } from "drizzle-orm";
import db from "../database";
import {
  notificationTable,
  pageTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { desktopSound, validTimeZone } from "../notification/desktop-sound";
import { canReceiveResourceNotification } from "../notification/resource-access";
import { getEmailBatchWindowSeconds } from "../notification-email/batch-window";
import { enqueueNotificationEmail } from "../notification-email/queue";
import { liveTaskCondition } from "../task/scope";
import { cleanPreferences } from "../user/controllers/user-preferences";
import { publicWebUrl } from "../utils/desktop-config";
import {
  safeOutboundError,
  sendOutboundRequest,
} from "../utils/outbound-request";
import {
  localizeNotificationText,
  renderNotificationText,
} from "./notification-text";
import { sendPushToUser } from "./push";
import { decryptSecret } from "./secrets";

const MAX_PUSH_TITLE_LENGTH = 120;
const MAX_PUSH_BODY_LENGTH = 240;
const GENERIC_BODY = "You have a new notification in Margaya.";

type ResolvedNotificationContext = {
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskUrl: string | null;
  // Where a push opens the app. A path, so it can only stay inside the app.
  path: string;
};

type DeliveryContent = {
  title: string;
  body: string;
};

function buildTaskPath(workspaceId: string, projectId: string, taskId: string) {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

export function buildTaskUrl(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  const clientUrl = process.env.MARGAYA_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}${buildTaskPath(workspaceId, projectId, taskId)}`;
}

function getStringValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function getNumberValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function formatLeadTime(minutes: number | null) {
  if (!minutes) return "soon";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${minutes} minutes`;
}

/** "Task updated" text for priority, due date and title changes. */
function taskUpdatedContent(
  data: Record<string, unknown> | null,
): DeliveryContent {
  const taskTitle = getStringValue(data, "taskTitle");
  const field = getStringValue(data, "field");
  const oldValue = getStringValue(data, "oldValue");
  const newValue = getStringValue(data, "newValue");
  const title = "Task updated";
  if (field === "priority" && taskTitle && newValue) {
    return {
      title,
      body: oldValue
        ? `Priority of ${taskTitle} changed from ${oldValue} to ${newValue}.`
        : `Priority of ${taskTitle} changed to ${newValue}.`,
    };
  }
  if (field === "dueDate" && taskTitle) {
    return {
      title,
      body: newValue
        ? `Due date of ${taskTitle} changed to ${newValue.slice(0, 10)}.`
        : `Due date of ${taskTitle} was removed.`,
    };
  }
  if (field === "title" && oldValue && newValue) {
    return { title, body: `${oldValue} was renamed to ${newValue}.` };
  }
  return {
    title,
    body: taskTitle
      ? `${taskTitle} was updated.`
      : "A task was updated in Margaya.",
  };
}

export function buildDeliveryContent(notification: {
  type: string;
  content: string | null;
  title: string | null;
  eventData: Record<string, unknown> | null;
}): DeliveryContent {
  if (notification.title && notification.content) {
    return {
      title: notification.title,
      body: notification.content,
    };
  }

  switch (notification.type) {
    case "task_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "New task created",
        body: taskTitle
          ? `A new task was created: ${taskTitle}`
          : "A new task was created in Margaya.",
      };
    }
    case "workspace_created": {
      const workspaceName = getStringValue(
        notification.eventData,
        "workspaceName",
      );
      return {
        title: "Workspace created",
        body: workspaceName
          ? `Workspace created: ${workspaceName}`
          : "A new workspace was created in Margaya.",
      };
    }
    case "task_status_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const oldStatus = getStringValue(notification.eventData, "oldStatus");
      const newStatus = getStringValue(notification.eventData, "newStatus");
      return {
        title: "Task status changed",
        body:
          taskTitle && oldStatus && newStatus
            ? `${taskTitle} moved from ${oldStatus} to ${newStatus}.`
            : "A task status changed in Margaya.",
      };
    }
    case "task_assignee_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task assigned to you",
        body: taskTitle
          ? `You were assigned to ${taskTitle}.`
          : "A task was assigned to you in Margaya.",
      };
    }
    case "time_entry_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Time entry created",
        body: taskTitle
          ? `A time entry was created for ${taskTitle}.`
          : "A time entry was created in Margaya.",
      };
    }
    case "due_date_reminder": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const label = formatLeadTime(
        getNumberValue(notification.eventData, "leadTimeMinutes"),
      );
      // The recipient's local due day, when the reminder job recorded it.
      const dueDay = getStringValue(notification.eventData, "dueDay");
      const when = dueDay ? `${label} (${dueDay})` : label;
      return {
        title: "Task due soon",
        body: taskTitle
          ? `"${taskTitle}" is due ${when}.`
          : `A task is due ${when}.`,
      };
    }
    case "task_overdue": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task overdue",
        body: taskTitle
          ? `"${taskTitle}" is past its due date.`
          : "A task is past its due date.",
      };
    }
    case "task_mention": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const mentionerName = getStringValue(
        notification.eventData,
        "mentionerName",
      );
      const inComment =
        getStringValue(notification.eventData, "source") === "comment";
      return {
        title: mentionerName
          ? `${mentionerName} mentioned you`
          : "You were mentioned",
        body: taskTitle
          ? inComment
            ? `You were mentioned in a comment on ${taskTitle}.`
            : `You were mentioned in ${taskTitle}.`
          : "You were mentioned in a Margaya task.",
      };
    }
    case "page_mention": {
      const pageTitle = getStringValue(notification.eventData, "pageTitle");
      const mentionerName = getStringValue(
        notification.eventData,
        "mentionerName",
      );
      return {
        title: mentionerName
          ? `${mentionerName} mentioned you`
          : "You were mentioned",
        body: pageTitle
          ? `You were mentioned in the page ${pageTitle}.`
          : "You were mentioned in a Margaya page.",
      };
    }
    case "page_comment": {
      const pageTitle = getStringValue(notification.eventData, "pageTitle");
      const commenterName = getStringValue(
        notification.eventData,
        "commenterName",
      );
      const commentPreview = getStringValue(
        notification.eventData,
        "commentPreview",
      );
      return {
        title: commenterName ? `${commenterName} commented` : "New comment",
        body: pageTitle
          ? commentPreview
            ? `New comment on ${pageTitle}: ${commentPreview}`
            : `A new comment was added to the page ${pageTitle}.`
          : "A new comment was added to a Margaya page.",
      };
    }
    case "page_updated": {
      const pageTitle = getStringValue(notification.eventData, "pageTitle");
      const editorName = getStringValue(notification.eventData, "editorName");
      return {
        title: editorName ? `${editorName} edited a page` : "A page was edited",
        body: pageTitle
          ? `The page ${pageTitle} was edited.`
          : "A Margaya page you watch was edited.",
      };
    }
    case "task_comment": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const commenterName = getStringValue(
        notification.eventData,
        "commenterName",
      );
      const commentPreview = getStringValue(
        notification.eventData,
        "commentPreview",
      );
      if (getStringValue(notification.eventData, "parentCommentId")) {
        return {
          title: commenterName
            ? `${commenterName} replied to a comment`
            : "New reply to a comment",
          body: taskTitle
            ? commentPreview
              ? `New reply on ${taskTitle}: ${commentPreview}`
              : `A new reply was added to ${taskTitle}.`
            : "A new reply was added to a Margaya task.",
        };
      }
      // Neutral wording: watchers receive it too, not only assignees.
      return {
        title: commenterName
          ? `${commenterName} commented`
          : "New task comment",
        body: taskTitle
          ? commentPreview
            ? `New comment on ${taskTitle}: ${commentPreview}`
            : `A new comment was added to ${taskTitle}.`
          : "A new comment was added to a Margaya task.",
      };
    }
    case "task_updated":
      return taskUpdatedContent(notification.eventData);
    default:
      return {
        title: notification.title ?? "New Margaya notification",
        body: notification.content ?? GENERIC_BODY,
      };
  }
}

/**
 * What an email or push message to one person says: the notification in
 * their language, rendered from `type` and `eventData`. English, free text
 * and anything that cannot be rendered keep buildDeliveryContent's wording,
 * which webhooks also send.
 */
export function buildRecipientDeliveryContent(
  notification: Parameters<typeof buildDeliveryContent>[0],
  locale: string | null | undefined,
): DeliveryContent {
  const english = buildDeliveryContent(notification);
  const localized = localizeNotificationText(notification, locale);
  return {
    title: localized?.title ?? english.title,
    body: localized?.body ?? english.body,
  };
}

async function resolveNotificationContext(notification: {
  resourceType: string | null;
  resourceId: string | null;
}): Promise<ResolvedNotificationContext | null> {
  if (!notification.resourceType || !notification.resourceId) {
    return null;
  }

  if (notification.resourceType === "task") {
    const [task] = await db
      .select({
        taskId: taskTable.id,
        taskTitle: taskTable.title,
        projectId: projectTable.id,
        projectName: projectTable.name,
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(
        and(
          eq(taskTable.id, notification.resourceId),
          liveTaskCondition,
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!task) {
      return null;
    }

    return {
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      projectId: task.projectId,
      projectName: task.projectName,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      taskUrl: buildTaskUrl(task.workspaceId, task.projectId, task.taskId),
      path: buildTaskPath(task.workspaceId, task.projectId, task.taskId),
    };
  }

  if (notification.resourceType === "workspace") {
    const [workspace] = await db
      .select({
        workspaceId: workspaceTable.id,
        workspaceName: workspaceTable.name,
      })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, notification.resourceId))
      .limit(1);

    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskUrl: null,
      path: `/dashboard/workspace/${workspace.workspaceId}/inbox`,
    };
  }

  if (notification.resourceType === "page") {
    const [page] = await db
      .select({
        id: pageTable.id,
        projectId: pageTable.projectId,
        workspaceId: pageTable.workspaceId,
        workspaceName: workspaceTable.name,
      })
      .from(pageTable)
      .innerJoin(workspaceTable, eq(pageTable.workspaceId, workspaceTable.id))
      .where(eq(pageTable.id, notification.resourceId))
      .limit(1);

    if (!page) {
      return null;
    }

    return {
      workspaceId: page.workspaceId,
      workspaceName: page.workspaceName,
      projectId: page.projectId,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskUrl: null,
      path: page.projectId
        ? `/dashboard/workspace/${page.workspaceId}/project/${page.projectId}/pages/${page.id}`
        : `/dashboard/workspace/${page.workspaceId}/inbox`,
    };
  }

  return null;
}

/**
 * What a push says. Only what the alert needs: a title, one fixed line, where
 * tapping it goes and an id so a repeat replaces it. The line is the app's own
 * sentence for the type, naming at most the task or page. What someone wrote
 * (comments, agent answers and questions, approval descriptions, automation
 * messages, decline reasons) stays out because a push shows on a lock screen;
 * the app shows it after the tap.
 */
function buildPushMessage(
  notificationId: string,
  source: Parameters<typeof buildDeliveryContent>[0],
  locale: string | null | undefined,
  path: string,
) {
  const {
    commentPreview: _commentPreview,
    message: _message,
    note: _note,
    ...eventData
  } = source.eventData ?? {};
  const fixed = {
    ...source,
    content: null,
    eventData: source.eventData ? eventData : null,
  };
  const rendered = renderNotificationText(fixed, resolveEmailLocale(locale));
  const english = buildDeliveryContent(fixed);
  // Agent notices have no sentence of their own: their title says it all.
  const line =
    english.body === GENERIC_BODY
      ? (emailCopy(locale).notificationText.pushFixedLine ?? GENERIC_BODY)
      : english.body;
  return {
    title: (rendered?.title ?? english.title).slice(0, MAX_PUSH_TITLE_LENGTH),
    body: (rendered?.body ?? line).slice(0, MAX_PUSH_BODY_LENGTH),
    url: path,
    tag: notificationId,
  };
}

/**
 * What Margaya Desktop shows for one of the user's notifications: the Web Push
 * text in their locale, with an absolute link to the web app. Null when the
 * notification isn't theirs or its resource is no longer theirs to see.
 */
export async function buildDesktopNotification(
  notificationId: string,
  userId: string,
  deviceTimeZone?: string | null,
) {
  const notification = await db.query.notificationTable.findFirst({
    where: and(
      eq(notificationTable.id, notificationId),
      eq(notificationTable.userId, userId),
    ),
  });
  if (
    !notification ||
    !(await canReceiveResourceNotification(
      userId,
      notification.resourceId,
      notification.resourceType,
    ))
  ) {
    return null;
  }

  const [context, [user]] = await Promise.all([
    resolveNotificationContext(notification),
    db
      .select({
        locale: userTable.locale,
        timezone: userTable.timezone,
        preferences: userTable.preferences,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1),
  ]);
  const message = buildPushMessage(
    notification.id,
    {
      type: notification.type,
      title: notification.title ?? null,
      content: notification.content ?? null,
      eventData:
        notification.eventData && typeof notification.eventData === "object"
          ? (notification.eventData as Record<string, unknown>)
          : null,
    },
    user?.locale,
    // Notifications without a resource still show in every inbox.
    context?.path ?? "/dashboard",
  );
  const sound = desktopSound({
    preference: cleanPreferences(user?.preferences).notificationSound,
    notification,
    now: new Date(),
    timeZone: validTimeZone(user?.timezone) ?? validTimeZone(deviceTimeZone),
  });
  return {
    id: notification.id,
    title: message.title,
    body: message.body,
    url: `${publicWebUrl()}${message.url}`,
    tag: message.tag,
    // Kept for desktop apps that predate `soundName`.
    sound: sound.soundName !== null,
    soundName: sound.soundName,
    volume: sound.volume,
  };
}

async function sendNtfyNotification(input: {
  serverUrl: string;
  topic: string;
  token?: string | null;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,
    {
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.clickUrl ? { Click: input.clickUrl } : {}),
        Title: input.title,
      },
      body: input.body,
    },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

async function sendGotifyNotification(input: {
  serverUrl: string;
  token: string;
  title: string;
  body: string;
  clickUrl?: string | null;
}) {
  // Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history, so factor this into Gotify placement and log handling.
  await sendOutboundRequest(
    `${input.serverUrl.replace(/\/+$/, "")}/message?token=${encodeURIComponent(
      input.token,
    )}`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        message: input.body,
        priority: 5,
        extras: input.clickUrl
          ? {
              "client::notification": {
                click: {
                  url: input.clickUrl,
                },
              },
              "client::display": {
                contentType: "text/plain",
              },
            }
          : undefined,
      }),
    },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

async function sendWebhookNotification(input: {
  webhookUrl: string;
  secret?: string | null;
  payload: Record<string, unknown>;
}) {
  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.secret) {
    headers["X-Margaya-Signature"] = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");
  }

  await sendOutboundRequest(
    input.webhookUrl,
    { headers, body },
    { publicDestination: true, timeoutMs: 15_000 },
  );
}

export async function deliverNotification(
  notificationId: string,
): Promise<void> {
  const notification = await db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });

  if (
    !notification ||
    !(await canReceiveResourceNotification(
      notification.userId,
      notification.resourceId,
      notification.resourceType,
    ))
  ) {
    return;
  }

  const context = await resolveNotificationContext(notification);
  if (!context) {
    console.info("Notification delivery skipped: unresolved context", {
      notificationId,
      notificationTableId: notification.id,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      reason:
        "resolveNotificationContext returned null (missing resource, deleted task, or unsupported resource type)",
    });
    return;
  }

  const [user] = await db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
      banned: userTable.banned,
      banExpires: userTable.banExpires,
    })
    .from(userTable)
    .where(eq(userTable.id, notification.userId))
    .limit(1);

  if (!user) {
    return;
  }

  const rule = await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, notification.userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, context.workspaceId),
    ),
    with: {
      selectedProjects: true,
    },
  });

  const ruleCoversResource =
    Boolean(rule?.isActive) &&
    (rule?.projectMode !== "selected" ||
      rule.selectedProjects.some(
        (project) => project.projectId === context.projectId,
      ));

  const source = {
    type: notification.type,
    title: notification.title ?? null,
    content: notification.content ?? null,
    eventData:
      notification.eventData && typeof notification.eventData === "object"
        ? (notification.eventData as Record<string, unknown>)
        : null,
  };
  const deliveries: Array<Promise<void>> = [];

  // Turning push on for a device is the opt-in: it needs no preference row or
  // workspace rule, and a rule only narrows it. A ban ends push like any access.
  const isBanned =
    user.banned === true && (!user.banExpires || user.banExpires > new Date());
  if (!isBanned && (!rule || (ruleCoversResource && rule.pushEnabled))) {
    deliveries.push(
      sendPushToUser(
        notification.userId,
        buildPushMessage(notification.id, source, user.locale, context.path),
        notification.type.endsWith("_mention") ? "high" : "normal",
      ),
    );
  }

  // Page notifications reach the inbox and push; the channels below stay
  // task and workspace only.
  if (rule && ruleCoversResource && notification.resourceType !== "page") {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      {
        where: eq(userNotificationPreferenceTable.userId, notification.userId),
      },
    );
    if (preference) {
      deliveries.push(
        ...configuredChannelDeliveries({
          notification,
          context,
          user,
          preference,
          rule,
          source,
        }),
      );
    }
  }

  const results = await Promise.allSettled(deliveries);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Notification delivery failed", {
        notificationId,
        error: safeOutboundError(result.reason),
      });
    }
  }
}

/** Email, ntfy, Gotify and webhook sends for one notification, as configured. */
function configuredChannelDeliveries({
  notification,
  context,
  user,
  preference,
  rule,
  source,
}: {
  notification: typeof notificationTable.$inferSelect;
  context: ResolvedNotificationContext;
  user: { email: string; name: string; locale: string | null };
  preference: typeof userNotificationPreferenceTable.$inferSelect;
  rule: typeof userNotificationWorkspaceRuleTable.$inferSelect;
  source: Parameters<typeof buildDeliveryContent>[0];
}): Array<Promise<void>> {
  const decryptedPreference = {
    ...preference,
    ntfyToken: decryptSecret(preference.ntfyToken),
    gotifyToken: decryptSecret(preference.gotifyToken),
    webhookSecret: decryptSecret(preference.webhookSecret),
  };

  // Webhooks are machine payloads and keep the English text; email and
  // push speak the recipient's language.
  const content = buildDeliveryContent(source);
  const personal = buildRecipientDeliveryContent(source, user.locale);

  const webhookPayload = {
    notification: {
      id: notification.id,
      type: notification.type,
      title: content.title,
      content: content.body,
      createdAt: notification.createdAt,
      eventData: notification.eventData,
      resourceId: notification.resourceId,
      resourceType: notification.resourceType,
    },
    workspace: {
      id: context.workspaceId,
      name: context.workspaceName,
    },
    project: context.projectId
      ? {
          id: context.projectId,
          name: context.projectName,
        }
      : null,
    task: context.taskId
      ? {
          id: context.taskId,
          title: context.taskTitle,
          url: context.taskUrl,
        }
      : null,
    user: {
      id: notification.userId,
      email: user.email,
      name: user.name,
    },
  };

  const deliveries: Array<Promise<void>> = [];

  if (decryptedPreference.emailEnabled && rule.emailEnabled && user.email) {
    // With a batch window the scheduler sends it later, grouped with the
    // user's other notifications; the other channels stay immediate.
    deliveries.push(
      getEmailBatchWindowSeconds() > 0
        ? enqueueNotificationEmail(notification.id, notification.userId)
        : sendNotificationEmail(user.email, personal.title, {
            title: personal.title,
            message: personal.body,
            actionUrl: context.taskUrl,
            locale: user.locale ?? null,
          }).then(() => undefined),
    );
  }

  if (
    decryptedPreference.ntfyEnabled &&
    decryptedPreference.ntfyServerUrl &&
    decryptedPreference.ntfyTopic &&
    rule.ntfyEnabled
  ) {
    deliveries.push(
      sendNtfyNotification({
        serverUrl: decryptedPreference.ntfyServerUrl,
        topic: decryptedPreference.ntfyTopic,
        token: decryptedPreference.ntfyToken,
        title: personal.title,
        body: personal.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (
    decryptedPreference.gotifyEnabled &&
    decryptedPreference.gotifyServerUrl &&
    decryptedPreference.gotifyToken &&
    rule.gotifyEnabled
  ) {
    deliveries.push(
      sendGotifyNotification({
        serverUrl: decryptedPreference.gotifyServerUrl,
        token: decryptedPreference.gotifyToken,
        title: personal.title,
        body: personal.body,
        clickUrl: context.taskUrl,
      }),
    );
  }

  if (
    decryptedPreference.webhookEnabled &&
    decryptedPreference.webhookUrl &&
    rule.webhookEnabled
  ) {
    deliveries.push(
      sendWebhookNotification({
        webhookUrl: decryptedPreference.webhookUrl,
        secret: decryptedPreference.webhookSecret,
        payload: webhookPayload,
      }),
    );
  }

  return deliveries;
}
