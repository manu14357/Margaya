import { responseTimestamp, z } from "../openapi";
import { STICKY_COLORS } from "./colors";

export const stickySchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    content: z.string().openapi({ description: "Markdown content." }),
    color: z.enum(STICKY_COLORS),
    position: z.number().openapi({
      description: "Display order, ascending. New stickies go on top.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Sticky");

export const stickyPageSchema = z
  .object({
    items: z.array(stickySchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next page; null on the last page.",
    }),
  })
  .openapi("StickyPage");

export const stickyRemovalSchema = z
  .object({ removed: z.boolean() })
  .openapi("StickyRemoval");

export const stickyReorderResultSchema = z
  .object({
    reordered: z.number().int().openapi({
      description: "How many stickies got a new position.",
    }),
  })
  .openapi("StickyReorderResult");
