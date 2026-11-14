// What each whiteboard event means for the board's history and the audit
// log. Pure, so the mapping and the edit throttle are unit-tested without a
// database. Stored action names are stable: add new ones, never rename.

/** Lifecycle changes, recorded in the audit log as `whiteboard.<action>`. */
export const BOARD_LIFECYCLE_ACTIONS = [
  "created",
  "renamed",
  "icon_changed",
  "locked",
  "unlocked",
  "archived",
  "unarchived",
  "published",
  "unpublished",
  "trashed",
  "restored",
  "purged",
] as const;

export type BoardLifecycleAction = (typeof BOARD_LIFECYCLE_ACTIONS)[number];

/**
 * What the board history lists. A purged board takes its history with it,
 * so "purged" only reaches the audit log; "edited" only the history.
 */
export const BOARD_HISTORY_ACTIONS = [
  "created",
  "renamed",
  "icon_changed",
  "locked",
  "unlocked",
  "archived",
  "unarchived",
  "published",
  "unpublished",
  "trashed",
  "restored",
  "edited",
] as const satisfies readonly (BoardLifecycleAction | "edited")[];

export type BoardHistoryAction = (typeof BOARD_HISTORY_ACTIONS)[number];

/** The events the history and the audit log listen to. */
export const BOARD_LIFECYCLE_EVENTS = [
  "whiteboard.created",
  "whiteboard.updated",
  "whiteboard.deleted",
  "whiteboard.restored",
  "whiteboard.purged",
] as const;

const UPDATE_CHANGES: Record<string, BoardLifecycleAction> = {
  locked: "locked",
  unlocked: "unlocked",
  archived: "archived",
  unarchived: "unarchived",
  published: "published",
  unpublished: "unpublished",
};

/**
 * The lifecycle actions one event stands for: none, one, or two when a
 * single request renamed the board and changed its icon.
 */
export function boardLifecycleActions(
  eventName: string,
  data: Record<string, unknown>,
): BoardLifecycleAction[] {
  switch (eventName) {
    case "whiteboard.created":
      return ["created"];
    case "whiteboard.deleted":
      return ["trashed"];
    case "whiteboard.restored":
      return ["restored"];
    case "whiteboard.purged":
      return ["purged"];
    case "whiteboard.updated": {
      if (data.change === "details") {
        const changed = Array.isArray(data.changed) ? data.changed : [];
        const actions: BoardLifecycleAction[] = [];
        if (changed.includes("title")) actions.push("renamed");
        if (changed.includes("icon")) actions.push("icon_changed");
        return actions;
      }
      const action =
        typeof data.change === "string" ? UPDATE_CHANGES[data.change] : null;
      return action ? [action] : [];
    }
    default:
      return [];
  }
}

/** One "edited" history row per person per board in this window. */
export const BOARD_EDIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * The people a content save should record as editors: each contributor
 * once, without those who already have an "edited" row less than the
 * window old.
 */
export function editorsToRecord(
  contributors: readonly unknown[],
  recentEdits: readonly { actorId: string | null; createdAt: Date }[],
  now: Date,
): string[] {
  const since = now.getTime() - BOARD_EDIT_WINDOW_MS;
  const recent = new Set(
    recentEdits
      .filter((edit) => edit.createdAt.getTime() > since)
      .map((edit) => edit.actorId),
  );
  const ids = contributors.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return [...new Set(ids)].filter((id) => !recent.has(id));
}
