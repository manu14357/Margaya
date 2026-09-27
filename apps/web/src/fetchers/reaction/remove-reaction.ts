import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { ReactionTarget } from "@/types/reaction";

/** Removes the caller's reaction; returns the target's groups. */
async function removeReaction(target: ReactionTarget, emoji: string) {
  const response = target.commentId
    ? await client.reaction.comment[":id"][":emoji"].$delete({
        param: { id: target.commentId, emoji },
      })
    : await client.reaction.task[":taskId"][":emoji"].$delete({
        param: { taskId: target.taskId, emoji },
      });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default removeReaction;
