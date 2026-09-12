import { DESCRIPTION_COALESCE_WINDOW_MS } from "../task-activity/coalesce";

// Task description history (C9). Pure rules: the tracker loads the rows,
// these decide. The window matches the description activity row's, so one
// burst of autosaves is one history entry and one feed row.

/** Versions kept per task; older ones are pruned on insert. */
export const DESCRIPTION_VERSION_LIMIT = 50;

export const DESCRIPTION_VERSION_WINDOW_MS = DESCRIPTION_COALESCE_WINDOW_MS;

/** Characters of plain text shown for a version in the list. */
export const DESCRIPTION_VERSION_PREVIEW_LENGTH = 140;

export type NewestVersion = {
  id: string;
  authorId: string | null;
  savedAt: Date;
};

export type VersionAction =
  | { action: "update"; id: string }
  | { action: "insert" };

/**
 * A save updates the newest version when that is the same author's from less
 * than ten minutes ago; a restore (forceNew), another author, or an older
 * version gets a new one.
 */
export function decideVersionAction({
  newest,
  authorId,
  now,
  forceNew = false,
}: {
  newest: NewestVersion | null | undefined;
  authorId: string | null;
  now: Date;
  forceNew?: boolean;
}): VersionAction {
  if (
    !forceNew &&
    newest &&
    authorId !== null &&
    newest.authorId === authorId &&
    now.getTime() - newest.savedAt.getTime() < DESCRIPTION_VERSION_WINDOW_MS
  ) {
    return { action: "update", id: newest.id };
  }
  return { action: "insert" };
}

/** Ids past the limit, from a list ordered newest first. */
export function versionsBeyondLimit(
  idsNewestFirst: readonly string[],
  limit = DESCRIPTION_VERSION_LIMIT,
): string[] {
  return idsNewestFirst.slice(limit);
}

/** Descriptions compare like the update routes do: null is "". */
export function sameDescription(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? "") === (b ?? "");
}
