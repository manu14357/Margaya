import {
  type EmailLocale,
  emailCopy,
  fill,
  type NotificationTexts,
  notificationCopy,
  plural,
  resolveEmailLocale,
} from "@margaya/email";

// A notification's email and push text in the recipient's language, built
// at send time from `type` + `eventData` with the web app's own strings, the
// way apps/web/src/lib/notification-text.ts renders the inbox. The stored
// `title`/`content` columns stay English for webhooks and older readers.

export type NotificationTextSource = {
  type: string;
  title: string | null;
  content: string | null;
  eventData: Record<string, unknown> | null;
};

/** Either part is null when it cannot be rendered in the language. */
export type LocalizedNotificationText = {
  title: string | null;
  body: string | null;
};

type Strings = Record<string, string | undefined>;
type Values = Record<string, string | number>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/gu;

/** Fills every placeholder, or null when one of them has no value. */
function fillAll(template: string | undefined, values: Values): string | null {
  if (!template) return null;
  for (const [, key] of template.matchAll(PLACEHOLDER)) {
    if (!key || !(key in values)) return null;
  }
  return fill(template, values);
}

/** The event data's non-empty strings and finite numbers. */
function templateValues(data: Record<string, unknown>): Values {
  const values: Values = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" ? value.length > 0 : Number.isFinite(value)) {
      values[key] = value as string | number;
    }
  }
  return values;
}

function stringField(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toDisplayCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** A default column's translated name; custom columns read as their slug. */
function statusLabel(texts: NotificationTexts, status: string) {
  const names = texts.tasks.status as Strings;
  return (status !== "label" && names[status]) || toDisplayCase(status);
}

function priorityLabel(texts: NotificationTexts, priority: string) {
  const names = texts.tasks.priority as Strings;
  return (priority !== "label" && names[priority]) || toDisplayCase(priority);
}

/** A calendar day, as stored (UTC timestamp or YYYY-MM-DD). */
function formatDay(value: string, lang: EmailLocale) {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value,
  );
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function leadTime(
  texts: NotificationTexts,
  lang: EmailLocale,
  data: Record<string, unknown>,
) {
  const minutes = Number(data.leadTimeMinutes ?? 1440);
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  const forms = texts.notifications.reminderLeadTime;
  if (minutes % 1440 === 0) return plural(forms, "days", lang, minutes / 1440);
  if (minutes % 60 === 0) return plural(forms, "hours", lang, minutes / 60);
  return plural(forms, "minutes", lang, minutes);
}

function titleTemplate(
  texts: NotificationTexts,
  type: string,
  data: Record<string, unknown>,
) {
  switch (type) {
    case "ai_approval_requested":
      return texts.ai.agents.inbox.title;
    case "ai_agent_reply":
      return data.needsInput === true
        ? texts.ai.agents.needsInput.notificationTitle
        : texts.ai.agents.reply.title;
    case "ai_budget_warning":
      return texts.ai.budget.notice.title;
    case "task_comment":
      return typeof data.parentCommentId === "string"
        ? texts.notifications.events.task_comment.titleReply
        : texts.notifications.events.task_comment.title;
    default:
      return (
        texts.notifications.events as unknown as Record<
          string,
          Strings | undefined
        >
      )[type]?.title;
  }
}

function taskUpdatedBody(
  texts: NotificationTexts,
  lang: EmailLocale,
  data: Record<string, unknown>,
  values: Values,
) {
  const event = texts.notifications.events.task_updated;
  const oldValue = stringField(data, "oldValue");
  const newValue = stringField(data, "newValue");
  switch (data.field) {
    case "priority":
      return fillAll(event.priority, {
        ...values,
        oldValue: priorityLabel(texts, oldValue ?? "no-priority"),
        newValue: priorityLabel(texts, newValue ?? "no-priority"),
      });
    case "dueDate":
      return newValue
        ? fillAll(event.dueDate, {
            ...values,
            newValue: formatDay(newValue, lang),
          })
        : fillAll(event.dueDateCleared, values);
    case "title":
      return fillAll(event.title_change, values);
    default:
      return null;
  }
}

function intakeBody(
  texts: NotificationTexts,
  type: string,
  data: Record<string, unknown>,
  values: Values,
) {
  const events = texts.notifications.events;
  const withKeys = { ...values };
  for (const key of ["taskKey", "duplicateKey"]) {
    const value = stringField(data, key);
    if (value) withKeys[key] = value.toUpperCase();
  }
  if (type === "intake_accepted") {
    return stringField(data, "columnName")
      ? fillAll(events.intake_accepted.content, withKeys)
      : fillAll(events.intake_accepted.contentBacklog, withKeys);
  }
  if (type === "intake_declined") {
    return stringField(data, "note")
      ? fillAll(events.intake_declined.contentWithReason, withKeys)
      : fillAll(events.intake_declined.content, withKeys);
  }
  return fillAll(events.intake_duplicate.content, withKeys);
}

function bodyText(
  texts: NotificationTexts,
  lang: EmailLocale,
  type: string,
  data: Record<string, unknown>,
  values: Values,
): string | null {
  const events = texts.notifications.events;
  switch (type) {
    case "task_created":
    case "workspace_created":
    case "task_assignee_changed":
    case "task_overdue":
    case "page_mention":
      return fillAll(events[type].content, values);
    case "page_comment":
    case "page_updated":
      // Read loosely so a missing translation falls back to the English text.
      return fillAll(
        (events as unknown as Record<string, Strings | undefined>)[type]
          ?.content,
        values,
      );
    case "task_comment":
      if (typeof data.parentCommentId === "string" && values.commentPreview) {
        return fillAll(events.task_comment.contentReply, values);
      }
      return values.commentPreview
        ? fillAll(events.task_comment.content, values)
        : fillAll(
            emailCopy(lang).notificationText.commentWithoutPreview,
            values,
          );
    case "task_mention":
      return fillAll(
        data.source === "comment"
          ? events.task_mention.contentComment
          : events.task_mention.content,
        values,
      );
    case "task_status_changed": {
      const oldStatus = stringField(data, "oldStatus");
      const newStatus = stringField(data, "newStatus");
      if (!oldStatus || !newStatus) return null;
      return fillAll(events.task_status_changed.content, {
        ...values,
        oldStatus: statusLabel(texts, oldStatus),
        newStatus: statusLabel(texts, newStatus),
      });
    }
    case "time_entry_created":
      return values.taskTitle
        ? fillAll(events.time_entry_created.contentWithTask, values)
        : fillAll(events.time_entry_created.contentWithoutTask, values);
    case "due_date_reminder": {
      const lead = leadTime(texts, lang, data);
      const text = lead
        ? fillAll(events.due_date_reminder.content, {
            ...values,
            leadTime: lead,
          })
        : null;
      // The recipient's local due day, when the reminder job recorded it.
      const dueDay = stringField(data, "dueDay");
      return text && dueDay ? `${text} (${formatDay(dueDay, lang)})` : text;
    }
    case "task_updated":
      return taskUpdatedBody(texts, lang, data, values);
    case "intake_accepted":
    case "intake_declined":
    case "intake_duplicate":
      return intakeBody(texts, type, data, values);
    case "cycle_rollover": {
      const count = Number(data.count);
      if (!Number.isInteger(count) || count < 0) return null;
      const key =
        data.outcome === "no_next_cycle" ? "contentNoNext" : "content";
      return fillAll(plural(events.cycle_rollover, key, lang, count), values);
    }
    case "flow_anomaly": {
      const key = `${String(data.metric)}_${String(data.direction)}`;
      const anomaly = events.flow_anomaly as Strings;
      if (
        key === "title" ||
        values.value === undefined ||
        values.baselineMedian === undefined
      ) {
        return null;
      }
      return fillAll(anomaly[key], {
        value: values.value,
        baseline: values.baselineMedian,
      });
    }
    case "ai_budget_warning":
      return values.usedPercent === undefined
        ? null
        : fillAll(texts.ai.budget.notice.content, {
            percent: values.usedPercent,
          });
    case "automation_notice":
      // The rule's own message, written by whoever set the rule up.
      return stringField(data, "message")
        ? null
        : fillAll(events.automation_notice.content, values);
    default:
      // Agent answers, approval descriptions and ad-hoc notices are free
      // text: they keep their stored wording.
      return null;
  }
}

/**
 * The notification's title and body in `locale`, or null for English
 * (which keeps buildDeliveryContent's wording) and for rows without
 * structured event data.
 */
export function localizeNotificationText(
  notification: NotificationTextSource,
  locale: string | null | undefined,
): LocalizedNotificationText | null {
  const lang = resolveEmailLocale(locale);
  return lang === "en" ? null : renderNotificationText(notification, lang);
}

/** The app's own wording of a notification, null without event data. */
export function renderNotificationText(
  notification: NotificationTextSource,
  lang: EmailLocale,
): LocalizedNotificationText | null {
  const data = notification.eventData;
  if (!data) return null;
  const texts = notificationCopy(lang);
  const values = templateValues(data);
  return {
    title: fillAll(titleTemplate(texts, notification.type, data), values),
    body: bodyText(texts, lang, notification.type, data, values),
  };
}
