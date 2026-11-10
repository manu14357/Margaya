import { z } from "../openapi";
import { INBOX_TABS, INBOX_VIEWS, parseInboxTypes } from "./inbox";

export const notificationParam = z.object({ id: z.string() });

export const desktopNotificationQuery = z.object({
  timeZone: z.string().max(64).optional().openapi({
    description:
      "The device's IANA time zone, for quiet hours when the account has none.",
    example: "Europe/Berlin",
  }),
});

export const createNotificationBody = z.object({
  title: z.string().nullable().optional(),
  message: z.string().nullable().optional().openapi({
    description: "Stored as the notification's content.",
  }),
  type: z.string(),
  eventData: z.record(z.string(), z.unknown()).nullable().optional(),
  relatedEntityId: z.string().optional().openapi({
    description:
      "Stored as resourceId: the task or workspace being pointed at.",
  }),
  relatedEntityType: z.string().optional().openapi({
    description: "Stored as resourceType: `task` or `workspace`.",
  }),
});

const inboxTab = z.enum(INBOX_TABS).openapi({
  description:
    "`all` (default) or `mentions` (only task_mention notifications).",
});

const inboxView = z.enum(INBOX_VIEWS).openapi({
  description:
    "`inbox` (default: neither archived nor currently snoozed), `snoozed` or `archived`.",
});

const inboxTypes = z
  .string()
  .max(64)
  .refine((value) => parseInboxTypes(value) !== null, {
    message: "Use a comma list of assigned, created and subscribed",
  })
  .openapi({
    description:
      "Comma list, any of: assigned (tasks assigned to me), created (tasks I created), subscribed (tasks I subscribed to and neither created nor am assigned to). Non-task notifications never match.",
    example: "assigned,subscribed",
  });

export const inboxQuery = z.object({
  workspaceId: z.string().min(1),
  tab: inboxTab.optional(),
  view: inboxView.optional(),
  unread: z.enum(["true", "false"]).optional().openapi({
    description: "`true` for unread notifications only.",
  }),
  types: inboxTypes.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: "Page size, 1-100 (default 50)." }),
  cursor: z.string().max(1024).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
});

export const inboxCountsQuery = z.object({
  workspaceId: z.string().min(1),
});

export const markAllReadQuery = z.object({
  workspaceId: z.string().min(1).optional().openapi({
    description:
      "Only this workspace's inbox (plus notifications without a workspace). Without it, every notification of the caller is marked read.",
  }),
  tab: inboxTab.optional(),
  view: inboxView.optional(),
  types: inboxTypes.optional(),
});

export const clearAllQuery = z.object({
  workspaceId: z.string().min(1).optional().openapi({
    description:
      "Only delete this workspace's notifications; notifications without a workspace are kept. Without it, every notification of the caller is deleted.",
  }),
});

export const snoozeBody = z.object({
  until: z.iso.datetime({ offset: true }).openapi({
    description:
      "When the notification returns to the Inbox view: an ISO 8601 date-time with offset, at least 1 minute and at most 366 days ahead.",
    example: "2026-10-01T09:00:00+02:00",
  }),
});
