import { BACKGROUND_PATTERNS } from "@margaya/whiteboard";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { BOARD_HISTORY_ACTIONS } from "./activity-map";

// Response schemas for /api/whiteboard and /api/public-whiteboard.

const person = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  })
  .nullable();

export const whiteboardCapabilitiesSchema = z
  .object({
    canEdit: z.boolean().openapi({
      description:
        "Edit the content, title and icon: whiteboard:update while the board is not locked or archived.",
    }),
    canManage: z.boolean().openapi({
      description:
        "Lock, archive and move to the trash: the board's creator with whiteboard:update, or whiteboard:delete.",
    }),
    canPublish: z.boolean().openapi({
      description:
        "Publish or unpublish a public link: whiteboard:delete, on a board that is not archived.",
    }),
    canDuplicate: z.boolean().openapi({
      description: "Make a copy: whiteboard:create.",
    }),
  })
  .openapi("WhiteboardCapabilities");

const summaryShape = {
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  title: z.string().openapi({ description: "May be empty (Untitled)." }),
  icon: z.string().nullable().openapi({ description: "One emoji, or null." }),
  isLocked: z.boolean(),
  lockedBy: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .openapi({ description: "Who locked it; null when unlocked." }),
  lockedAt: nullableResponseTimestamp,
  archivedAt: nullableResponseTimestamp,
  publicToken: z.string().nullable().openapi({
    description:
      "The public link token while published; null when unpublished or when the caller can't manage the board.",
  }),
  publishedAt: nullableResponseTimestamp,
  elementCount: z.number().int().openapi({
    description: "Live elements on the board at the last save.",
  }),
  contentVersion: z.number().int().openapi({
    description: "Grows on every content save; use it to bust cached previews.",
  }),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  createdBy: person,
  updatedBy: person,
};

export const whiteboardSummarySchema = z
  .object(summaryShape)
  .openapi("WhiteboardSummary");

export const whiteboardSchema = z
  .object({ ...summaryShape, capabilities: whiteboardCapabilitiesSchema })
  .openapi("Whiteboard");

export const whiteboardListSchema = z
  .object({ whiteboards: z.array(whiteboardSummarySchema) })
  .openapi("WhiteboardList");

export const whiteboardProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    icon: z.string().nullable().openapi({
      description: "The project's icon name; its colour comes from its id.",
    }),
  })
  .openapi("WhiteboardProject");

export const workspaceWhiteboardSchema = z
  .object({ ...summaryShape, project: whiteboardProjectSchema })
  .openapi("WorkspaceWhiteboard");

export const workspaceWhiteboardListSchema = z
  .object({ whiteboards: z.array(workspaceWhiteboardSchema) })
  .openapi("WorkspaceWhiteboardList");

export const whiteboardElementSchema = z
  .record(z.string(), z.unknown())
  .openapi("WhiteboardElement", {
    description:
      "A validated board element: id, type, geometry, style, version and the type's own fields.",
  });

/** Board elements as the JSON the response schemas describe. */
export function elementsJson(
  elements: readonly unknown[],
): z.infer<typeof whiteboardElementSchema>[] {
  return elements as z.infer<typeof whiteboardElementSchema>[];
}

export const whiteboardSettingsSchema = z
  .object({
    background: z.string(),
    gridSize: z.number().openapi({
      description: "Snap grid size in board units; 0 turns snapping off.",
    }),
    pattern: z.enum(BACKGROUND_PATTERNS).openapi({
      description:
        "The visible canvas background: plain (the default), dots, grid or ruled lines.",
    }),
    patternSize: z.number().openapi({
      description: "Spacing of the background pattern in board units.",
    }),
  })
  .openapi("WhiteboardSettings");

export const whiteboardContentSchema = z
  .object({
    elements: z.array(whiteboardElementSchema).openapi({
      description:
        "Live elements in stacking order; deleted ones are left out.",
    }),
    settings: whiteboardSettingsSchema,
    contentVersion: z.number().int(),
  })
  .openapi("WhiteboardContent");

export const whiteboardElementsResultSchema = z
  .object({
    elements: z.array(whiteboardElementSchema).openapi({
      description: "The elements as written, with their new versions.",
    }),
    skipped: z.number().int().openapi({
      description:
        "Elements left out: invalid ones that could not be repaired, and repeated ids (the newest copy is kept).",
    }),
    contentVersion: z.number().int(),
  })
  .openapi("WhiteboardElementsResult");

export const whiteboardPublicationSchema = z
  .object({
    publicToken: z.string().nullable(),
    publishedAt: nullableResponseTimestamp,
  })
  .openapi("WhiteboardPublication");

export const whiteboardActivityEntrySchema = z
  .object({
    id: z.string(),
    action: z.enum(BOARD_HISTORY_ACTIONS).openapi({
      description:
        "What happened. edited is written at most once per person per board every 10 minutes while they draw.",
    }),
    actor: person.openapi({
      description: "Who did it; null for the system or a deleted account.",
    }),
    title: z.string().nullable().openapi({
      description:
        "The board's title at the time (after a rename, the new one).",
    }),
    createdAt: responseTimestamp,
  })
  .openapi("WhiteboardActivityEntry");

export const whiteboardActivityPageSchema = z
  .object({
    items: z.array(whiteboardActivityEntrySchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next (older) page; null at the end.",
    }),
  })
  .openapi("WhiteboardActivityPage");

export const deletedWhiteboardSchema = z
  .object({ id: z.string(), projectId: z.string() })
  .openapi("DeletedWhiteboard");

export const whiteboardAssetUploadSchema = z
  .object({
    assetId: z.string().openapi({
      description: "The image's id once finalized; reference it on the board.",
    }),
    upload: z.object({
      uploadUrl: z.string().openapi({
        description: "PUT the image bytes here.",
      }),
      headers: z.record(z.string(), z.string()).openapi({
        description: "Headers the upload must carry, including Content-Type.",
      }),
    }),
  })
  .openapi("WhiteboardAssetUpload");

export const whiteboardAssetSchema = z
  .object({
    id: z.string(),
    whiteboardId: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("WhiteboardAsset");

export const taskCardSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    statusName: z.string(),
    statusColor: z.string().nullable(),
    assigneeName: z.string().nullable(),
    dueDate: z.string().nullable(),
    priority: z.string().nullable(),
    done: z.boolean(),
  })
  .openapi("WhiteboardTaskCard");

export const publicWhiteboardSchema = z
  .object({
    title: z.string(),
    icon: z.string().nullable(),
    elements: z.array(whiteboardElementSchema).openapi({
      description:
        "Live elements. Image elements reference /public-whiteboard/{token}/assets/{assetId}; editor ids are left out.",
    }),
    settings: whiteboardSettingsSchema,
    tasks: z.record(z.string(), taskCardSchema).openapi({
      description:
        "Task cards by task id: a snapshot of the board's tasks in its own project. Cards of other tasks have no entry.",
    }),
    updatedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("PublicWhiteboard");
