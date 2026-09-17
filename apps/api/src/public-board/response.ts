import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { REACTION_EMOJI } from "../reaction/emoji";

// Public board response shapes (B12 §3.6). No user ids or emails anywhere.

const person = z
  .object({ name: z.string(), image: z.string().nullable() })
  .openapi("PublicPerson");

const label = z
  .object({ name: z.string(), color: z.string() })
  .openapi("PublicLabel");

export const publicBoardSchema = z
  .object({
    project: z.object({
      name: z.string(),
      slug: z.string(),
      icon: z.string().nullable(),
      description: z.string().nullable(),
      descriptionDeferred: z.boolean(),
    }),
    board: z.object({
      layouts: z.array(z.enum(["board", "list"])),
      defaultLayout: z.enum(["board", "list"]),
      comments: z.boolean(),
      reactions: z.boolean(),
      votes: z.boolean(),
      requests: z.boolean().openapi({
        description: "Effective: the switch and the project's Intake feature.",
      }),
      guestsAllowed: z.boolean().openapi({
        description: "Effective: the switch and the server's guest access.",
      }),
      showAssignees: z.boolean(),
      showBacklog: z.boolean(),
    }),
    participation: z.boolean().openapi({
      description: "The server allows public participation.",
    }),
    columns: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        icon: z.string().nullable(),
        group: z.string(),
        isFinal: z.boolean(),
      }),
    ),
    labels: z.array(label),
    sorts: z.array(
      z.enum(["manual", "newest", "updated", "dueDate", "priority", "votes"]),
    ),
    reactionSet: z.array(z.enum(REACTION_EMOJI)),
    viewer: z.object({
      kind: z.enum(["visitor", "guest", "account"]),
      name: z.string().nullable(),
      image: z.string().nullable(),
      isMember: z.boolean(),
      blocked: z.boolean(),
      can: z.object({
        comment: z.boolean(),
        react: z.boolean(),
        vote: z.boolean(),
        request: z.boolean(),
      }),
    }),
    instance: z.object({
      name: z.string(),
      guestSignInAvailable: z.boolean(),
      signUpAvailable: z.boolean(),
    }),
  })
  .openapi("PublicBoard");

const rowFields = {
  id: z.string(),
  number: z.number().int().nullable(),
  key: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueDate: nullableResponseTimestamp,
  startDate: nullableResponseTimestamp,
  labels: z.array(label),
  assignees: z.array(person).optional().openapi({
    description: "Only when the board shows assignees.",
  }),
};

export const publicTaskRowSchema = z
  .object({
    ...rowFields,
    counts: z
      .object({
        votesUp: z.number().int().optional(),
        votesDown: z.number().int().optional(),
        reactions: z
          .array(z.object({ emoji: z.string(), count: z.number().int() }))
          .optional()
          .openapi({ description: "The top 3 task reactions." }),
        comments: z.number().int().optional().openapi({
          description: "Public comments only.",
        }),
      })
      .openapi({ description: "Present only for features that are on." }),
  })
  .openapi("PublicTaskRow");

export const publicTaskPageSchema = z
  .object({
    groups: z.array(
      z.object({
        key: z.string(),
        count: z.number().int(),
        taskIds: z.array(z.string()),
        nextCursor: z.string().nullable(),
      }),
    ),
    tasks: z.record(z.string(), publicTaskRowSchema),
    totalCount: z.number().int(),
  })
  .openapi("PublicTaskPage");

export const publicReactionGroupSchema = z
  .object({
    emoji: z.enum(REACTION_EMOJI),
    count: z.number().int(),
    reacted: z.boolean().openapi({ description: "The viewer has it." }),
  })
  .openapi("PublicReactionGroup");

export const publicReactionGroupListSchema = z.array(publicReactionGroupSchema);

export const publicVoteStateSchema = z
  .object({
    up: z.number().int(),
    down: z.number().int(),
    mine: z.union([z.literal(1), z.literal(-1)]).nullable(),
  })
  .openapi("PublicVoteState");

export const publicTaskDetailSchema = z
  .object({
    ...rowFields,
    column: z.object({
      name: z.string(),
      icon: z.string().nullable(),
      group: z.string(),
      isFinal: z.boolean(),
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    description: z.string().nullable(),
    descriptionDeferred: z.boolean(),
    externalLinks: z.array(
      z
        .object({
          id: z.string(),
          resourceType: z.string(),
          externalId: z.string(),
          url: z.string(),
          title: z.string().nullable(),
          metadata: z.record(z.string(), z.unknown()).nullable(),
          createdAt: responseTimestamp,
          updatedAt: responseTimestamp,
        })
        .openapi("PublicExternalLink"),
    ),
    votes: publicVoteStateSchema.optional(),
    reactions: publicReactionGroupListSchema.optional(),
    commentCount: z.number().int().optional(),
    can: z.object({
      comment: z.boolean(),
      react: z.boolean(),
      vote: z.boolean(),
    }),
  })
  .openapi("PublicTaskDetail");

export const publicCommentSchema = z
  .object({
    id: z.string(),
    content: z.string().openapi({ description: "Markdown." }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    edited: z.boolean(),
    author: z.object({
      name: z.string(),
      image: z.string().nullable(),
      badge: z.enum(["member", "guest"]).nullable(),
      isYou: z.boolean(),
    }),
    reactions: publicReactionGroupListSchema.optional(),
    can: z.object({ edit: z.boolean(), delete: z.boolean() }),
  })
  .openapi("PublicComment");

export const publicCommentPageSchema = z
  .object({
    items: z.array(publicCommentSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("PublicCommentPage");

export const publicRequestSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["in_review", "accepted", "declined", "duplicate"]),
    note: z.string().nullable(),
    createdAt: responseTimestamp,
    boardTaskNumber: z.number().int().nullable().openapi({
      description:
        "The accepted task, or the duplicate target, when it is on this board.",
    }),
    canWithdraw: z.boolean(),
  })
  .openapi("PublicRequest");

export const publicRequestPageSchema = z
  .object({
    items: z.array(publicRequestSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("PublicRequestPage");

export const publicIdSchema = z
  .object({ id: z.string() })
  .openapi("PublicDeletedId");
