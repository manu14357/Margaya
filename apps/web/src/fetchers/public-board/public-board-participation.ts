import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { PublicReactionGroup } from "@/types/public-board";

// Reactions on a public task or comment, and my vote on a task.

export type PublicReactionTarget =
  | { kind: "task"; number: number }
  | { kind: "comment"; commentId: string };

function reactionRequest(
  token: string,
  target: PublicReactionTarget,
  emoji: string,
  on: boolean,
) {
  const board = client["public-board"][":token"];
  if (target.kind === "task") {
    const route = board.tasks[":number"].reactions[":emoji"];
    const param = { token, number: String(target.number), emoji };
    return on ? route.$put({ param }) : route.$delete({ param });
  }
  const route = board.comments[":commentId"].reactions[":emoji"];
  const param = { token, commentId: target.commentId, emoji };
  return on ? route.$put({ param }) : route.$delete({ param });
}

/** Adds (`on`) or removes my reaction; answers the target's counts. */
export async function togglePublicBoardReaction(
  token: string,
  target: PublicReactionTarget,
  emoji: string,
  on: boolean,
): Promise<PublicReactionGroup[]> {
  const response = await reactionRequest(token, target, emoji, on);
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** Sets my vote (1 or -1), or removes it with null. */
export async function setPublicBoardVote(
  token: string,
  number: number,
  value: 1 | -1 | null,
) {
  const route = client["public-board"][":token"].tasks[":number"].vote;
  const param = { token, number: String(number) };
  const response =
    value === null
      ? await route.$delete({ param })
      : await route.$put({ param, json: { value } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
