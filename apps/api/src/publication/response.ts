import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { PUBLIC_LAYOUTS } from "./settings";

const layout = z.enum(PUBLIC_LAYOUTS);
const authorKind = z.enum(["member", "external", "guest"]).openapi({
  description:
    "member: in the workspace; guest: a guest account; external: any other account.",
});

export const projectPublicationSchema = z
  .object({
    projectId: z.string(),
    published: z.boolean(),
    publishedAt: nullableResponseTimestamp,
    publishedBy: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    linkToken: z.string().nullable().openapi({
      description: "Null until the first publish or settings change.",
    }),
    path: z.string().nullable().openapi({
      description: "/public-project/{token}; prefix it with the web origin.",
    }),
    layouts: z.array(layout),
    defaultLayout: layout,
    commentsEnabled: z.boolean(),
    reactionsEnabled: z.boolean(),
    votesEnabled: z.boolean(),
    requestsEnabled: z.boolean(),
    allowGuests: z.boolean(),
    showAssignees: z.boolean(),
    showBacklog: z.boolean(),
    availability: z
      .object({
        publicBoards: z.boolean().openapi({
          description: "The server's public boards switch.",
        }),
        participation: z.boolean().openapi({
          description: "The server's public participation switch.",
        }),
        requests: z.boolean().openapi({
          description: "The project's Intake feature is on.",
        }),
        guests: z.boolean().openapi({
          description: "Guest sign-in is available on this server.",
        }),
      })
      .openapi("PublicationAvailability"),
    canManage: z.boolean().openapi({
      description: "The caller holds project:share.",
    }),
    updatedAt: nullableResponseTimestamp,
  })
  .openapi("ProjectPublication");

export const publicCommentModerationPageSchema = z
  .object({
    items: z.array(
      z
        .object({
          commentId: z.string(),
          taskId: z.string(),
          taskKey: z.string(),
          taskTitle: z.string(),
          excerpt: z.string().openapi({
            description: "The first 200 characters, markup removed.",
          }),
          createdAt: responseTimestamp,
          author: z
            .object({
              id: z.string(),
              name: z.string(),
              image: z.string().nullable(),
              kind: authorKind,
            })
            .nullable(),
        })
        .openapi("PublicCommentModerationItem"),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("PublicCommentModerationPage");

export const publicBoardBlockSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    kind: authorKind,
    blockedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("PublicBoardBlock");

export const publicBoardBlockResultSchema = publicBoardBlockSchema
  .extend({ hiddenComments: z.number() })
  .openapi("PublicBoardBlockResult");

export const taskVoteSummarySchema = z
  .object({
    enabled: z.boolean().openapi({
      description: "The project's board has votes turned on.",
    }),
    up: z.number(),
    down: z.number(),
    score: z.number(),
  })
  .openapi("TaskVoteSummary");
