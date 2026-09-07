// The allowed reactions (B10 K9), in picker order, stored as stable keys.
export const REACTION_EMOJI = [
  "thumbs_up",
  "thumbs_down",
  "smile",
  "boom",
  "confused",
  "heart",
  "airplane",
  "eyes",
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export const UNSUPPORTED_REACTION = "Unsupported reaction";

/** How many reacting users a group lists (earliest first). */
export const MAX_REACTION_USERS = 10;

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJI as readonly string[]).includes(value);
}

export type ReactionUser = { id: string; name: string; image: string | null };

export type ReactionGroup = {
  emoji: ReactionEmoji;
  count: number;
  reacted: boolean;
  users: ReactionUser[];
};

export type ReactionRow = {
  commentId: string | null;
  emoji: string;
  userId: string;
  name: string;
  image: string | null;
  createdAt: Date;
};

/**
 * One target's rows (oldest first) as groups: ordered by each emoji's first
 * use, ties by the allowed order; users capped, earliest first. Rows with
 * a key outside the allowed set are ignored.
 */
export function groupReactions(
  rows: readonly ReactionRow[],
  callerId: string,
): ReactionGroup[] {
  const groups = new Map<ReactionEmoji, ReactionGroup & { firstAt: number }>();
  for (const row of rows) {
    if (!isReactionEmoji(row.emoji)) continue;
    let group = groups.get(row.emoji);
    if (!group) {
      group = {
        emoji: row.emoji,
        count: 0,
        reacted: false,
        users: [],
        firstAt: row.createdAt.getTime(),
      };
      groups.set(row.emoji, group);
    }
    group.firstAt = Math.min(group.firstAt, row.createdAt.getTime());
    group.count += 1;
    if (row.userId === callerId) group.reacted = true;
    if (group.users.length < MAX_REACTION_USERS) {
      group.users.push({ id: row.userId, name: row.name, image: row.image });
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.firstAt - b.firstAt ||
        REACTION_EMOJI.indexOf(a.emoji) - REACTION_EMOJI.indexOf(b.emoji),
    )
    .map(({ firstAt: _firstAt, ...group }) => group);
}

/** A task's rows split into the task's own groups and each comment's. */
export function groupTaskReactions(
  rows: readonly ReactionRow[],
  callerId: string,
): {
  task: ReactionGroup[];
  comments: { commentId: string; groups: ReactionGroup[] }[];
} {
  const taskRows: ReactionRow[] = [];
  const byComment = new Map<string, ReactionRow[]>();
  for (const row of rows) {
    if (row.commentId === null) {
      taskRows.push(row);
    } else {
      const list = byComment.get(row.commentId) ?? [];
      list.push(row);
      byComment.set(row.commentId, list);
    }
  }
  return {
    task: groupReactions(taskRows, callerId),
    comments: [...byComment.entries()]
      .map(([commentId, list]) => ({
        commentId,
        groups: groupReactions(list, callerId),
      }))
      .filter((entry) => entry.groups.length > 0),
  };
}
