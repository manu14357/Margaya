import { z } from "../openapi";
import { REACTION_EMOJI } from "./emoji";

export const reactionUserSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("ReactionUser");

export const reactionGroupSchema = z
  .object({
    emoji: z.enum(REACTION_EMOJI),
    count: z.number().int(),
    reacted: z.boolean().openapi({
      description: "The current user has this reaction.",
    }),
    users: z.array(reactionUserSchema).openapi({
      description: "Who reacted, earliest first, at most 10.",
    }),
  })
  .openapi("ReactionGroup");

export const reactionGroupListSchema = z.array(reactionGroupSchema);

export const taskReactionsSchema = z
  .object({
    task: reactionGroupListSchema.openapi({
      description:
        "Reactions on the task itself, ordered by each emoji's first use.",
    }),
    comments: z
      .array(
        z.object({ commentId: z.string(), groups: reactionGroupListSchema }),
      )
      .openapi({ description: "Only comments that have reactions." }),
  })
  .openapi("TaskReactions");
