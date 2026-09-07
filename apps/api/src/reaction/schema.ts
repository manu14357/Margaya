import { z } from "../openapi";
import { REACTION_EMOJI } from "./emoji";

const emoji = z.string().openapi({
  description: `The reaction key, one of: ${REACTION_EMOJI.join(", ")}.`,
  example: "thumbs_up",
});

export const taskReactionsParam = z.object({ taskId: z.string().min(1) });

export const taskReactionParam = z.object({
  taskId: z.string().min(1),
  emoji,
});

export const commentReactionParam = z.object({
  id: z.string().min(1).openapi({ description: "The comment's id." }),
  emoji,
});
