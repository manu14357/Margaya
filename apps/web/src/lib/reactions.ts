import type { TranslateFn } from "@/lib/notification-text";

// The allowed reactions (B10 §1.3), in picker order. The API stores the
// keys; the characters and labels are the web's.

export const REACTIONS = [
  {
    key: "thumbs_up",
    emoji: "👍",
    labelKey: "activity:reactions.labels.thumbs_up",
  },
  {
    key: "thumbs_down",
    emoji: "👎",
    labelKey: "activity:reactions.labels.thumbs_down",
  },
  { key: "smile", emoji: "😄", labelKey: "activity:reactions.labels.smile" },
  { key: "boom", emoji: "💥", labelKey: "activity:reactions.labels.boom" },
  {
    key: "confused",
    emoji: "😕",
    labelKey: "activity:reactions.labels.confused",
  },
  { key: "heart", emoji: "🧡", labelKey: "activity:reactions.labels.heart" },
  {
    key: "airplane",
    emoji: "✈️",
    labelKey: "activity:reactions.labels.airplane",
  },
  { key: "eyes", emoji: "👀", labelKey: "activity:reactions.labels.eyes" },
] as const;

export type ReactionDefinition = (typeof REACTIONS)[number];
export type ReactionKey = ReactionDefinition["key"];

export type ReactionUserLike = {
  id: string;
  name: string;
  image: string | null;
};

export type ReactionGroupLike<K extends string = string> = {
  emoji: K;
  count: number;
  reacted: boolean;
  users: ReactionUserLike[];
};

/** How many names the API lists per group. */
const MAX_LISTED_USERS = 10;
/** How many names a chip's tooltip shows before "and N more". */
const MAX_TOOLTIP_NAMES = 5;

export function getReaction(key: string): ReactionDefinition | undefined {
  return REACTIONS.find((reaction) => reaction.key === key);
}

/**
 * The groups after I toggle one reaction: my reaction is removed when I
 * had it, else added. Empty groups disappear; a new group goes last.
 */
export function applyReactionToggle<G extends ReactionGroupLike>(
  groups: readonly G[],
  key: G["emoji"],
  me: ReactionUserLike,
): G[] {
  const existing = groups.find((group) => group.emoji === key);
  if (!existing) {
    return [
      ...groups,
      { emoji: key, count: 1, reacted: true, users: [me] } as G,
    ];
  }

  return groups.flatMap((group) => {
    if (group.emoji !== key) return [group];
    if (group.reacted) {
      const count = group.count - 1;
      if (count <= 0) return [];
      return [
        {
          ...group,
          count,
          reacted: false,
          users: group.users.filter((user) => user.id !== me.id),
        },
      ];
    }
    return [
      {
        ...group,
        count: group.count + 1,
        reacted: true,
        users:
          group.users.length < MAX_LISTED_USERS
            ? [...group.users, me]
            : group.users,
      },
    ];
  });
}

/** "You, Ana and 3 more reacted with Heart" for a chip's tooltip. */
export function formatReactionUsers(
  group: ReactionGroupLike,
  meId: string | undefined,
  t: TranslateFn,
): string {
  const others = group.users
    .filter((user) => user.id !== meId)
    .map((user) => user.name);
  const names = group.reacted
    ? [t("activity:reactions.you"), ...others]
    : others;
  const listed = names.slice(0, MAX_TOOLTIP_NAMES);
  const more = Math.max(0, group.count - listed.length);
  const joined = listed.join(", ");
  const label = t(getReaction(group.emoji)?.labelKey ?? group.emoji);
  return t("activity:reactions.reactedWith", {
    names:
      more > 0
        ? t("activity:reactions.namesMore", { names: joined, count: more })
        : joined,
    label,
  });
}
