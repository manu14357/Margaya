import { z } from "../openapi";
import { STICKY_COLORS } from "./colors";
import { STICKY_CONTENT_MAX_LENGTH } from "./plain-text";

export const STICKIES_LIMIT = 500;
export const DEFAULT_STICKY_PAGE_SIZE = 30;
export const STICKY_BODY_BYTES = 128 * 1024;
export const STICKY_REORDER_BODY_BYTES = 64 * 1024;

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const stickyParam = z.object({ id: z.string() });

export const stickyColor = z.enum(STICKY_COLORS).openapi({
  description:
    "Background color, one of the label color keys. Defaults to yellow.",
});

const stickyContent = z.string().max(STICKY_CONTENT_MAX_LENGTH).openapi({
  description:
    "Markdown written by the comment editor, at most 20,000 characters.",
});

export const listStickiesQuery = z.object({
  workspaceId: z.string(),
  q: z.string().trim().max(200).optional().openapi({
    description:
      "Case-insensitive text search over the sticky's plain text (trimmed, at most 200 characters). Empty means no filter.",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: "Page size, 1-100 (default 30)." }),
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
});

export const createStickyBody = z.object({
  workspaceId: z.string(),
  content: stickyContent.optional(),
  color: stickyColor.optional(),
});

export const updateStickyBody = z
  .object({
    content: stickyContent.optional(),
    color: stickyColor.optional(),
  })
  .strict()
  .openapi({ description: "Send content, color or both." });

export const reorderStickiesBody = z.object({
  stickyIds: z
    .array(z.string())
    .min(1)
    .max(STICKIES_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Sticky ids must be unique",
    })
    .openapi({
      description:
        "Sticky ids in their new relative order. Stickies left out keep their rank.",
    }),
});
