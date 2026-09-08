/** Description saves by one person closer together than this share a row. */
export const DESCRIPTION_COALESCE_WINDOW_MS = 10 * 60 * 1000;

export type NewestActivity = {
  id: string;
  type: string;
  userId: string | null;
  /** How long ago the row was written (or last bumped), in milliseconds. */
  ageMs: number;
};

export type DescriptionActivityDecision =
  | { action: "update"; activityId: string }
  | { action: "insert" };

/**
 * The editor autosaves, so one row per save would flood the feed: when the
 * task's newest row is this person's own description change from less than
 * ten minutes ago, that row is refreshed instead of adding another.
 */
export function decideDescriptionActivity(
  newest: NewestActivity | null | undefined,
  userId: string,
): DescriptionActivityDecision {
  if (
    newest &&
    newest.type === "description_changed" &&
    newest.userId === userId &&
    newest.ageMs < DESCRIPTION_COALESCE_WINDOW_MS
  ) {
    return { action: "update", activityId: newest.id };
  }
  return { action: "insert" };
}
