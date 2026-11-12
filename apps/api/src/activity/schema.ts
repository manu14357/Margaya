import { aiAssistInput } from "../ai/provenance";
import { z } from "../openapi";

export const taskIdParam = z.object({ taskId: z.string() });

export const memberActivityParam = z.object({ userId: z.string() });

export const myActivityQuery = z.object({
  workspaceId: z.string(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .openapi({ description: "Page size, 1-50 (default 10)." }),
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
});

export const createActivityBody = z.object({
  taskId: z.string(),
  message: z.string().nullable().openapi({
    description:
      "Free-text body. Null for events whose meaning is in eventData.",
  }),
  type: z.string().openapi({
    description:
      "The event kind, e.g. status_changed, assignee_changed or unassigned.",
  }),
  eventData: z.record(z.string(), z.unknown()).nullable().optional().openapi({
    description: "Type-specific payload stored alongside the event.",
  }),
});

export const createCommentBody = z.object({
  taskId: z.string(),
  comment: z.string().max(10_000),
  parentId: z.string().min(1).max(128).optional().openapi({
    description:
      "Reply in a thread: the id of a comment on the same task. A reply to a reply joins the top-level comment's thread (threads are one level deep). 404 when the comment is not on this task.",
  }),

  aiAssist: aiAssistInput,
});

export const updateCommentBody = z.object({
  activityId: z.string(),
  comment: z.string().max(10_000),
  aiAssist: aiAssistInput,
});

export const deleteCommentBody = z.object({ activityId: z.string() });
