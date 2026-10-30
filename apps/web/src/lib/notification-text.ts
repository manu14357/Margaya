import { formatDateMedium } from "@/lib/format";
import { getPriorityLabel, getStatusLabel } from "@/lib/i18n/domain";

// Display text of notifications: the dropdown's title and content lines,
// and the inbox rows' "{actor} {verb}" line. Generated notifications carry
// no text; it is rendered here from `type` and `eventData`.

export type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export type NotificationTextSource = {
  type: string;
  title: string | null;
  content: string | null;
  eventData: unknown;
  actor?: { name: string } | null;
};

/** Types caused by a person; every other type reads as a system message. */
const ACTOR_TYPES = new Set([
  "task_created",
  "task_assignee_changed",
  "task_status_changed",
  "task_comment",
  "task_mention",
  "time_entry_created",
  "task_updated",
  "intake_accepted",
  "intake_declined",
  "intake_duplicate",
  "page_mention",
  "ai_approval_requested",
  "ai_agent_reply",
]);

const TITLE_KEYS: Record<string, string> = {
  task_created: "notifications:events.task_created.title",
  workspace_created: "notifications:events.workspace_created.title",
  task_status_changed: "notifications:events.task_status_changed.title",
  task_assignee_changed: "notifications:events.task_assignee_changed.title",
  time_entry_created: "notifications:events.time_entry_created.title",
  task_mention: "notifications:events.task_mention.title",
  task_comment: "notifications:events.task_comment.title",
  due_date_reminder: "notifications:events.due_date_reminder.title",
  task_overdue: "notifications:events.task_overdue.title",
  task_updated: "notifications:events.task_updated.title",
  intake_accepted: "notifications:events.intake_accepted.title",
  intake_declined: "notifications:events.intake_declined.title",
  intake_duplicate: "notifications:events.intake_duplicate.title",
  page_mention: "notifications:events.page_mention.title",
  cycle_rollover: "notifications:events.cycle_rollover.title",
  flow_anomaly: "notifications:events.flow_anomaly.title",
  automation_notice: "notifications:events.automation_notice.title",
  ai_approval_requested: "ai:agents.inbox.title",
  ai_agent_reply: "ai:agents.reply.title",
  ai_budget_warning: "ai:budget.notice.title",
};

const CONTENT_KEYS: Record<string, string> = {
  page_mention: "notifications:events.page_mention.content",
  task_created: "notifications:events.task_created.content",
  workspace_created: "notifications:events.workspace_created.content",
  task_assignee_changed: "notifications:events.task_assignee_changed.content",
  task_comment: "notifications:events.task_comment.content",
  task_overdue: "notifications:events.task_overdue.content",
};

const VERB_KEYS: Record<string, string> = {
  task_created: "notifications:inbox.verbs.task_created",
  task_assignee_changed: "notifications:inbox.verbs.task_assignee_changed",
  task_comment: "notifications:inbox.verbs.task_comment",
  time_entry_created: "notifications:inbox.verbs.time_entry_created",
  task_overdue: "notifications:inbox.verbs.task_overdue",
  intake_accepted: "notifications:inbox.verbs.intake_accepted",
  intake_declined: "notifications:inbox.verbs.intake_declined",
  intake_duplicate: "notifications:inbox.verbs.intake_duplicate",
  ai_approval_requested: "ai:agents.inbox.verb",
  ai_agent_reply: "ai:agents.reply.verb",
};

export function getEventDataRecord(
  eventData: unknown,
): Record<string, unknown> | null {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return null;
  }

  return eventData as Record<string, unknown>;
}

function stringField(
  eventData: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = eventData?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getReminderLeadTime(
  eventData: Record<string, unknown>,
  t: TranslateFn,
) {
  const minutes = Number(eventData.leadTimeMinutes ?? 1440);
  if (minutes % 1440 === 0) {
    return t("notifications:reminderLeadTime.days", {
      count: minutes / 1440,
    });
  }
  if (minutes % 60 === 0) {
    return t("notifications:reminderLeadTime.hours", {
      count: minutes / 60,
    });
  }
  return t("notifications:reminderLeadTime.minutes", { count: minutes });
}

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateMedium(date);
}

/** An agent paused its run to ask the person something. */
function isAgentQuestion(
  type: string,
  eventData: Record<string, unknown> | null,
): boolean {
  return type === "ai_agent_reply" && eventData?.needsInput === true;
}

/** A comment notification about a reply in a thread. */
function isCommentReply(
  type: string,
  eventData: Record<string, unknown> | null,
): boolean {
  return (
    type === "task_comment" &&
    stringField(eventData, "parentCommentId") !== null
  );
}

export function getNotificationTitle(
  notification: NotificationTextSource,
  t: TranslateFn,
) {
  const eventData = getEventDataRecord(notification.eventData);
  const key = isAgentQuestion(notification.type, eventData)
    ? "ai:agents.needsInput.notificationTitle"
    : isCommentReply(notification.type, eventData)
      ? "notifications:events.task_comment.titleReply"
      : TITLE_KEYS[notification.type];
  if (eventData && key) {
    return t(key, {
      ...eventData,
      defaultValue: notification.title ?? notification.type,
    });
  }

  return notification.title ?? notification.type;
}

function getTaskUpdatedContent(
  eventData: Record<string, unknown>,
  fallback: string,
  t: TranslateFn,
) {
  const field = eventData.field;
  const oldValue = stringField(eventData, "oldValue");
  const newValue = stringField(eventData, "newValue");
  switch (field) {
    case "priority":
      return t("notifications:events.task_updated.priority", {
        ...eventData,
        oldValue: getPriorityLabel(oldValue ?? "no-priority"),
        newValue: getPriorityLabel(newValue ?? "no-priority"),
        defaultValue: fallback,
      });
    case "dueDate":
      return newValue
        ? t("notifications:events.task_updated.dueDate", {
            ...eventData,
            newValue: formatDueDate(newValue),
            defaultValue: fallback,
          })
        : t("notifications:events.task_updated.dueDateCleared", {
            ...eventData,
            defaultValue: fallback,
          });
    case "title":
      return t("notifications:events.task_updated.title_change", {
        ...eventData,
        defaultValue: fallback,
      });
    default:
      return fallback;
  }
}

export function getNotificationContent(
  notification: NotificationTextSource,
  t: TranslateFn,
) {
  const fallback = notification.content ?? "";
  const eventData = getEventDataRecord(notification.eventData);
  if (!eventData) return fallback;

  const options = { ...eventData, defaultValue: fallback };
  if (isCommentReply(notification.type, eventData)) {
    return t("notifications:events.task_comment.contentReply", options);
  }
  const contentKey = CONTENT_KEYS[notification.type];
  if (contentKey) return t(contentKey, options);
  switch (notification.type) {
    case "task_status_changed":
      return t("notifications:events.task_status_changed.content", {
        ...options,
        oldStatus: getStatusLabel(String(eventData.oldStatus ?? "")),
        newStatus: getStatusLabel(String(eventData.newStatus ?? "")),
      });
    case "time_entry_created":
      return eventData.taskTitle
        ? t("notifications:events.time_entry_created.contentWithTask", options)
        : t(
            "notifications:events.time_entry_created.contentWithoutTask",
            options,
          );
    case "task_mention":
      return eventData.source === "comment"
        ? t("notifications:events.task_mention.contentComment", options)
        : t("notifications:events.task_mention.content", options);
    case "due_date_reminder":
      return t("notifications:events.due_date_reminder.content", {
        ...options,
        leadTime: getReminderLeadTime(eventData, t),
      });
    case "task_updated":
      return getTaskUpdatedContent(eventData, fallback, t);
    case "intake_accepted":
    case "intake_declined":
    case "intake_duplicate":
      return getIntakeContent(notification.type, eventData, fallback, t);
    case "cycle_rollover":
      return eventData.outcome === "no_next_cycle"
        ? t("notifications:events.cycle_rollover.contentNoNext", options)
        : t("notifications:events.cycle_rollover.content", options);
    case "flow_anomaly":
      return getFlowAnomalyContent(eventData, fallback, t);
    case "ai_budget_warning":
      return t("ai:budget.notice.content", {
        percent: eventData.usedPercent,
        defaultValue: fallback,
      });
    case "automation_notice":
      // The rule's own message, written by whoever set the rule up.
      return typeof eventData.message === "string" && eventData.message
        ? eventData.message
        : t("notifications:events.automation_notice.content", options);
    default:
      return fallback;
  }
}

const FLOW_ANOMALY_KEYS: Record<string, string> = {
  throughput_low: "notifications:events.flow_anomaly.throughput_low",
  wip_high: "notifications:events.flow_anomaly.wip_high",
  cycle_time_high: "notifications:events.flow_anomaly.cycle_time_high",
};

/** "Throughput fell to 2 tasks this week (usually about 14)", and kin. */
function getFlowAnomalyContent(
  eventData: Record<string, unknown>,
  fallback: string,
  t: TranslateFn,
) {
  const key =
    FLOW_ANOMALY_KEYS[
      `${String(eventData.metric)}_${String(eventData.direction)}`
    ];
  if (!key) return fallback;
  return t(key, {
    value: eventData.value,
    baseline: eventData.baselineMedian,
    defaultValue: fallback,
  });
}

/** A flow alert opens the project's Delivery analytics. */
export function getFlowAnomalyTarget(
  notification: NotificationTextSource,
): { projectId: string } | null {
  if (notification.type !== "flow_anomaly") return null;
  const projectId = stringField(
    getEventDataRecord(notification.eventData),
    "projectId",
  );
  return projectId ? { projectId } : null;
}

/** A requester's outcome: accepted into a column, declined, duplicate. */
function getIntakeContent(
  type: string,
  eventData: Record<string, unknown>,
  fallback: string,
  t: TranslateFn,
) {
  const keys = {
    taskKey: stringField(eventData, "taskKey")?.toUpperCase() ?? "",
    duplicateKey: stringField(eventData, "duplicateKey")?.toUpperCase() ?? "",
  };
  const options = { ...eventData, ...keys, defaultValue: fallback };
  if (type === "intake_accepted") {
    return stringField(eventData, "columnName")
      ? t("notifications:events.intake_accepted.content", options)
      : t("notifications:events.intake_accepted.contentBacklog", options);
  }
  if (type === "intake_declined") {
    return stringField(eventData, "note")
      ? t("notifications:events.intake_declined.contentWithReason", options)
      : t("notifications:events.intake_declined.content", options);
  }
  return t("notifications:events.intake_duplicate.content", options);
}

/**
 * A declined or duplicate request opens in its intake queue (Closed tab);
 * an accepted one opens as the task it became, like any task notification.
 */
export function getIntakeNotificationTarget(
  notification: NotificationTextSource,
): { projectId: string; itemId: string } | null {
  if (
    notification.type !== "intake_declined" &&
    notification.type !== "intake_duplicate"
  ) {
    return null;
  }
  const eventData = getEventDataRecord(notification.eventData);
  const projectId = stringField(eventData, "projectId");
  const itemId = stringField(eventData, "intakeItemId");
  return projectId && itemId ? { projectId, itemId } : null;
}

/** A page mention opens the page: its project and id. */
export function getPageNotificationTarget(
  notification: NotificationTextSource & {
    resourceType?: string | null;
    resourceId?: string | null;
  },
): { projectId: string; pageId: string } | null {
  if (notification.type !== "page_mention") return null;
  const eventData = getEventDataRecord(notification.eventData);
  const projectId = stringField(eventData, "projectId");
  const pageId =
    notification.resourceType === "page" ? notification.resourceId : null;
  return projectId && pageId ? { projectId, pageId } : null;
}

/** The mentioned page's title, when a page mention's payload carries one. */
export function getPageMentionTitle(
  notification: NotificationTextSource,
): string | null {
  if (notification.type !== "page_mention") return null;
  const eventData = getEventDataRecord(notification.eventData);
  return stringField(eventData, "pageTitle")?.trim() || null;
}

/** True for rows without a person behind them (reminders, info). */
export function isSystemNotification(notification: NotificationTextSource) {
  return !ACTOR_TYPES.has(notification.type);
}

/** Who caused it: the joined actor, then names kept in the event data. */
export function getNotificationActorName(
  notification: NotificationTextSource,
): string | null {
  if (notification.actor?.name) return notification.actor.name;
  const eventData = getEventDataRecord(notification.eventData);
  return (
    stringField(eventData, "actorName") ??
    stringField(eventData, "commenterName") ??
    stringField(eventData, "mentionerName")
  );
}

function getTaskUpdatedVerb(
  eventData: Record<string, unknown>,
  notification: NotificationTextSource,
  t: TranslateFn,
) {
  const newValue = stringField(eventData, "newValue");
  switch (eventData.field) {
    case "priority":
      return t("notifications:inbox.verbs.task_updated.priority", {
        newValue: getPriorityLabel(newValue ?? "no-priority"),
      });
    case "dueDate":
      return newValue
        ? t("notifications:inbox.verbs.task_updated.dueDate", {
            newValue: formatDueDate(newValue),
          })
        : t("notifications:inbox.verbs.task_updated.dueDateCleared");
    case "title":
      return t("notifications:inbox.verbs.task_updated.title");
    default:
      return getNotificationTitle(notification, t);
  }
}

/**
 * The inbox row's verb phrase: "{actor} {verb}" for people's actions, the
 * whole sentence for system rows.
 */
export function getNotificationVerb(
  notification: NotificationTextSource,
  t: TranslateFn,
) {
  const eventData = getEventDataRecord(notification.eventData) ?? {};
  if (isAgentQuestion(notification.type, eventData)) {
    return t("ai:agents.needsInput.verb");
  }
  if (isCommentReply(notification.type, eventData)) {
    return t("notifications:inbox.verbs.task_comment_reply");
  }
  const verbKey = VERB_KEYS[notification.type];
  if (verbKey) return t(verbKey);
  switch (notification.type) {
    case "task_status_changed":
      return t("notifications:inbox.verbs.task_status_changed", {
        oldStatus: getStatusLabel(String(eventData.oldStatus ?? "")),
        newStatus: getStatusLabel(String(eventData.newStatus ?? "")),
      });
    case "task_mention":
      return eventData.source === "comment"
        ? t("notifications:inbox.verbs.task_mention_comment")
        : t("notifications:inbox.verbs.task_mention");
    case "task_updated":
      return getTaskUpdatedVerb(eventData, notification, t);
    case "page_mention": {
      const pageTitle = getPageMentionTitle(notification);
      return pageTitle
        ? t("notifications:inbox.verbs.page_mention_titled", { pageTitle })
        : t("notifications:inbox.verbs.page_mention");
    }
    case "due_date_reminder":
      return t("notifications:inbox.verbs.due_date_reminder", {
        leadTime: getReminderLeadTime(eventData, t),
      });
    default:
      return getNotificationTitle(notification, t);
  }
}

/** The plain-text comment preview of comment and mention rows. */
export function getNotificationPreview(
  notification: NotificationTextSource,
): string | null {
  if (
    notification.type !== "task_comment" &&
    notification.type !== "task_mention"
  ) {
    return null;
  }
  return stringField(
    getEventDataRecord(notification.eventData),
    "commentPreview",
  );
}

/** The comment a comment or mention notification points at. */
export function getNotificationCommentId(
  notification: NotificationTextSource,
): string | null {
  return stringField(getEventDataRecord(notification.eventData), "commentId");
}
