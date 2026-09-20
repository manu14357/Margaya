import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type TaskReactions = InferResponseType<
  (typeof client)["reaction"]["task"][":taskId"]["$get"],
  200
>;

export type ReactionGroup = TaskReactions["task"][number];

export type ReactionUser = ReactionGroup["users"][number];

/** A task itself, or one of its comments. */
export type ReactionTarget = { taskId: string; commentId?: string };
