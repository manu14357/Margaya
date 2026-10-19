import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const notificationSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    title: z.string().nullable(),
    content: z.string().nullable().openapi({
      description:
        "Free-text body. Null for generated notifications, whose text the client renders from type and eventData.",
    }),
    type: z.string().openapi({
      description:
        "One of: info, task_created, workspace_created, task_status_changed, task_assignee_changed, time_entry_created, due_date_reminder, task_overdue, task_mention, task_comment, task_updated, intake_accepted, intake_declined, intake_duplicate, page_mention, automation_notice (an automation rule's notify action; eventData.ruleName, eventData.message).",
    }),
    eventData: z.unknown().openapi({
      description:
        "Type-specific payload. Task notifications carry { taskTitle, taskKey, projectId, workspaceId, actorName }, plus { oldStatus, newStatus } for status changes, { commenterName, commentId, commentPreview } for comments, { mentionerName, source, commentId, commentPreview } for mentions, { field, oldValue, newValue } for task_updated (field is priority, dueDate or title), { leadTimeMinutes, dueDate, dueDay } for reminders (dueDay is the due date's day in the recipient's time zone), and { pageTitle, mentionerName, projectId, workspaceId } for page_mention (resourceType page).",
    }),
    isRead: z.boolean().nullable(),
    resourceId: z.string().nullable().openapi({
      description:
        "The id of the task or workspace the notification points at.",
    }),
    resourceType: z.string().nullable().openapi({
      description: "`task` or `workspace`.",
    }),
    workspaceId: z.string().nullable().optional().openapi({
      description:
        "The workspace the notification belongs to, derived from its resource. Null for notifications without a resource, which show in every workspace's inbox.",
    }),
    actorId: z.string().nullable().optional().openapi({
      description:
        "Who caused it. Null for system notifications (reminders) and integration changes.",
    }),
    archivedAt: nullableResponseTimestamp.optional(),
    snoozedUntil: nullableResponseTimestamp.optional().openapi({
      description: "Snoozed until this instant; hidden from the Inbox view.",
    }),
    resurfacedAt: nullableResponseTimestamp.optional().openapi({
      description:
        "When a snooze ended; the Inbox view orders by this, else createdAt.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Notification");

export const notificationListSchema = z.array(notificationSchema);

export const bulkResultSchema = z
  .object({
    success: z.boolean(),
    updatedCount: z.number().int().optional().openapi({
      description: "How many notifications were changed or deleted.",
    }),
  })
  .openapi("NotificationBulkResult");

export const inboxNotificationSchema = notificationSchema
  .extend({
    actor: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable()
      .openapi({ description: "Who caused it; never includes an email." }),
    task: z
      .object({
        id: z.string(),
        key: z.string().openapi({ example: "WEB-12" }),
        title: z.string(),
        projectId: z.string(),
        projectName: z.string(),
      })
      .nullable()
      .openapi({
        description:
          "The notification's task, read fresh (current title). Null for non-task notifications and deleted tasks.",
      }),
    sortAt: responseTimestamp.openapi({
      description:
        "The instant the current view orders by: resurfacedAt or createdAt (inbox), snoozedUntil (snoozed), archivedAt (archived).",
    }),
    isSnoozed: z.boolean().openapi({
      description: "True while snoozedUntil is in the future.",
    }),
  })
  .openapi("InboxNotification");

export const inboxPageSchema = z
  .object({
    items: z.array(inboxNotificationSchema),
    nextCursor: z.string().nullable().openapi({
      description:
        "Pass as `cursor` for the next page with the same view; null on the last page.",
    }),
  })
  .openapi("InboxPage");

export const inboxCountsSchema = z
  .object({
    unread: z.number().int().openapi({
      description: "Unread notifications in the Inbox view, every type.",
    }),
    unreadMentions: z.number().int().openapi({
      description: "Unread mentions in the Inbox view.",
    }),
  })
  .openapi("InboxCounts");
