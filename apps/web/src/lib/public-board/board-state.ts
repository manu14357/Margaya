import type {
  PublicReactionGroup,
  PublicTaskPage,
  PublicVoteState,
} from "@/types/public-board";

// Pure state helpers of the public board: merging "load more" pages and
// the optimistic vote and reaction updates.

export type TaskPageSlice = { group: string; page: PublicTaskPage };

/**
 * A first page per column plus the "load more" pages of single columns.
 * Tasks merge by id, so a row repeated after a change shows once.
 */
export function mergeTaskPages(
  base: PublicTaskPage,
  slices: readonly TaskPageSlice[],
): PublicTaskPage {
  const groups = base.groups.map((group) => ({
    ...group,
    taskIds: [...group.taskIds],
  }));
  let tasks = base.tasks;
  for (const slice of slices) {
    const group = groups.find((candidate) => candidate.key === slice.group);
    const more = slice.page.groups.find(
      (candidate) => candidate.key === slice.group,
    );
    if (!group || !more) continue;
    tasks = { ...tasks, ...slice.page.tasks };
    const seen = new Set(group.taskIds);
    for (const id of more.taskIds) {
      if (!seen.has(id)) {
        seen.add(id);
        group.taskIds.push(id);
      }
    }
    group.nextCursor = more.nextCursor;
  }
  return { ...base, groups, tasks };
}

/** How many tasks of a column are not loaded yet. */
export function remainingInGroup(group: PublicTaskPage["groups"][number]) {
  return Math.max(0, group.count - group.taskIds.length);
}

/**
 * Clicking a vote button: my current vote is removed, the other value
 * replaces it. Returns the optimistic state and the value to send.
 */
export function applyVote(
  state: PublicVoteState,
  clicked: 1 | -1,
): { next: PublicVoteState; value: 1 | -1 | null } {
  let { up, down } = state;
  if (state.mine === 1) up -= 1;
  if (state.mine === -1) down -= 1;
  if (state.mine === clicked) {
    return {
      next: { up: Math.max(0, up), down: Math.max(0, down), mine: null },
      value: null,
    };
  }
  if (clicked === 1) up += 1;
  else down += 1;
  return {
    next: { up: Math.max(0, up), down: Math.max(0, down), mine: clicked },
    value: clicked,
  };
}

/**
 * Toggling my reaction on counts-only groups (no names on the public
 * board): removed when I had it, else added. Empty groups disappear.
 */
export function applyPublicReaction(
  groups: readonly PublicReactionGroup[],
  emoji: PublicReactionGroup["emoji"],
): PublicReactionGroup[] {
  const existing = groups.find((group) => group.emoji === emoji);
  if (!existing) return [...groups, { emoji, count: 1, reacted: true }];
  return groups.flatMap((group) => {
    if (group.emoji !== emoji) return [group];
    if (group.reacted) {
      const count = group.count - 1;
      return count > 0 ? [{ ...group, count, reacted: false }] : [];
    }
    return [{ ...group, count: group.count + 1, reacted: true }];
  });
}
