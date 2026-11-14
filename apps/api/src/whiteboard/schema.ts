import { z } from "../openapi";
import { WHITEBOARD_LIMITS } from "./rules";

// Request schemas for /api/whiteboard. Board elements are validated by the
// shared board model (sanitizeElements), not here: these schemas only bound
// the request and describe it for the API reference.

export const whiteboardElementInput = z
  .record(z.string(), z.unknown())
  .openapi("WhiteboardElementInput", {
    description:
      "A board element as plain JSON (id, type, geometry, style and the type's own fields). Unknown fields are dropped, numbers are clamped to the board limits, and an element that can't be repaired is skipped.",
  });

const elementList = z
  .array(whiteboardElementInput)
  .max(WHITEBOARD_LIMITS.elementsPerRequest)
  .openapi({
    description: `At most ${WHITEBOARD_LIMITS.elementsPerRequest} elements.`,
  });

const title = z
  .string()
  .max(WHITEBOARD_LIMITS.titleLength)
  .openapi({ description: "May be empty (Untitled)." });

const icon = z
  .string()
  .max(16)
  .nullable()
  .openapi({ description: "One emoji, or null for none." });

export const whiteboardParam = z.object({
  id: z.string().min(1).openapi({ description: "The whiteboard's id." }),
});

export const whiteboardAssetParam = whiteboardParam.extend({
  assetId: z.string().min(1).openapi({ description: "The image's id." }),
});

export const whiteboardActivityQuery = z.object({
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
});

export const taskWhiteboardsParam = z.object({
  taskId: z.string().min(1).openapi({ description: "The task's id." }),
});

export const listWhiteboardsQuery = z.object({
  projectId: z.string().min(1).openapi({ description: "The project's id." }),
  archived: z.enum(["true", "false"]).optional().openapi({
    description:
      "true lists archived boards instead of live ones (default false).",
  }),
  q: z.string().trim().max(200).optional().openapi({
    description:
      "Only boards whose title or text on the board contains this, ignoring case.",
  }),
});

export const workspaceWhiteboardsParam = z.object({
  workspaceId: z
    .string()
    .min(1)
    .openapi({ description: "The workspace's id." }),
});

export const listWorkspaceWhiteboardsQuery = listWhiteboardsQuery.omit({
  projectId: true,
});

export const createWhiteboardBody = z
  .strictObject({
    projectId: z.string().min(1),
    title: title.optional(),
    icon: icon.optional(),
    elements: elementList.optional().openapi({
      description:
        "Starting content, for example a template. Elements are validated like any edit.",
    }),
  })
  .openapi("CreateWhiteboardInput");

export const updateWhiteboardBody = z
  .strictObject({ title: title.optional(), icon: icon.optional() })
  .openapi("UpdateWhiteboardInput", { minProperties: 1 });

export const duplicateWhiteboardBody = z
  .strictObject({
    title: title.optional().openapi({
      description:
        "The copy's title; the server adds nothing to it. Defaults to the source's title.",
    }),
  })
  .openapi("DuplicateWhiteboardInput");

export const addWhiteboardElementsBody = z
  .strictObject({
    elements: elementList.min(1),
  })
  .openapi("AddWhiteboardElementsInput");

export const whiteboardAssetUploadBody = z
  .strictObject({
    filename: z.string().min(1).max(255),
    contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    size: z.number().int().positive(),
  })
  .openapi("WhiteboardAssetUploadInput");

export const finalizeWhiteboardAssetBody = z
  .strictObject({
    contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    size: z.number().int().positive(),
    width: z.number().int().positive().max(100_000).optional().openapi({
      description:
        "The image's width in pixels, used when the server can't read it from the file.",
    }),
    height: z.number().int().positive().max(100_000).optional(),
  })
  .openapi("FinalizeWhiteboardAssetInput");
