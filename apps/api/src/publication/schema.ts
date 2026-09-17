import { z } from "../openapi";
import { PUBLIC_LAYOUTS } from "./settings";

export const projectIdParam = z.object({ projectId: z.string() });
export const commentIdParam = z.object({ commentId: z.string() });
export const taskIdParam = z.object({ taskId: z.string() });
export const blockParam = z.object({
  projectId: z.string(),
  userId: z.string(),
});

const layouts = z.array(z.enum(PUBLIC_LAYOUTS)).max(2).openapi({
  description:
    "Allowed layouts: one or both of board and list, without duplicates.",
});

const settingsShape = {
  layouts: layouts.optional(),
  defaultLayout: z.enum(PUBLIC_LAYOUTS).optional().openapi({
    description: "Must be one of the allowed layouts.",
  }),
  commentsEnabled: z.boolean().optional(),
  reactionsEnabled: z.boolean().optional(),
  votesEnabled: z.boolean().optional(),
  requestsEnabled: z.boolean().optional().openapi({
    description: "Needs the project's Intake feature turned on.",
  }),
  allowGuests: z.boolean().optional().openapi({
    description:
      "Lets guests comment and react. Takes effect only while guest access is available on this server.",
  }),
  showAssignees: z.boolean().optional(),
  showBacklog: z.boolean().optional().openapi({
    description: "Shows tasks not on the board yet as a Backlog column.",
  }),
};

export const updatePublicationBody = z
  .object(settingsShape)
  .strict()
  .openapi("UpdateProjectPublicationInput");

export const publishBody = z
  .object(settingsShape)
  .strict()
  .openapi("PublishProjectInput");

export const commentListQuery = z.object({
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
  limit: z.coerce.number().int().min(1).max(50).optional().openapi({
    description: "1 to 50 (default 20).",
  }),
});

export const commentVisibilityBody = z
  .object({ visibility: z.enum(["internal", "public"]) })
  .strict();

export const blockBody = z
  .object({
    hideComments: z.boolean().optional().openapi({
      description:
        "Also makes every public comment of this person on the project internal.",
    }),
  })
  .strict();
