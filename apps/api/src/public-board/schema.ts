import { z } from "../openapi";
import { REACTION_EMOJI } from "../reaction/emoji";

// Request schemas of the public board router (B12 §3.4). Path parameters
// are plain strings: the resolvers answer 404 for anything malformed.

export const tokenParam = z.object({
  token: z.string().openapi({ description: "The board's link token." }),
});

export const taskNumberParam = tokenParam.extend({
  number: z.string().openapi({ description: "The task number." }),
});

export const commentParam = tokenParam.extend({ commentId: z.string() });

export const requestParam = tokenParam.extend({ requestId: z.string() });

const emojiParam = z.string().openapi({
  description: `One of ${REACTION_EMOJI.join(", ")}.`,
});

export const taskReactionParam = taskNumberParam.extend({ emoji: emojiParam });

export const commentReactionParam = commentParam.extend({ emoji: emojiParam });

const limitParam = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

export const boardTasksQuery = z.object({
  status: z.string().max(4000).optional().openapi({
    description:
      "Comma list of column slugs (and planned when the backlog is shown). Unknown values are dropped.",
  }),
  priority: z.string().max(200).optional().openapi({
    description: "Comma list of urgent, high, medium, low, no-priority.",
  }),
  label: z.string().max(2000).optional().openapi({
    description: "Comma list of label names (at most 20).",
  }),
  q: z.string().max(500).optional().openapi({ description: "Search text." }),
  sort: z.string().max(20).optional().openapi({
    description:
      "manual (default), newest, updated, dueDate, priority, or votes when votes are on.",
  }),
  group: z.string().max(200).optional().openapi({
    description: "Load more in this column (with cursor).",
  }),
  cursor: z.string().max(2000).optional(),
  limit: limitParam(100, 50),
});

export const commentPageQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: limitParam(50, 50),
});

export const requestPageQuery = z.object({
  cursor: z.string().max(500).optional(),
});

export const commentBody = z
  .object({ content: z.string().max(20_000) })
  .openapi("PublicCommentInput");

export const voteBody = z
  .object({
    value: z.union([z.literal(1), z.literal(-1)]).openapi({
      description: "1 for up, -1 for down.",
    }),
  })
  .openapi("PublicVoteInput");

export const requestBody = z
  .object({
    title: z.string().max(2000),
    description: z.string().max(30_000).optional(),
  })
  .openapi("PublicRequestInput");
