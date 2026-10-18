// WORKSPACE_DELETION_GRACE_DAYS: how long a workspace scheduled for deletion
// stays read-only (and can be restored by its owner) before the purge job
// deletes it. 0 deletes it at the next hourly purge run.

export const DEFAULT_WORKSPACE_DELETION_GRACE_DAYS = 14;
const MAX_WORKSPACE_DELETION_GRACE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export function workspaceDeletionGraceDays(
  raw: string | undefined = process.env.WORKSPACE_DELETION_GRACE_DAYS,
): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return DEFAULT_WORKSPACE_DELETION_GRACE_DAYS;
  }
  return Math.min(
    MAX_WORKSPACE_DELETION_GRACE_DAYS,
    Number.parseInt(trimmed, 10),
  );
}

/** When a deletion scheduled at `scheduledAt` becomes due. */
export function deletionDueAt(
  scheduledAt: Date,
  days: number = workspaceDeletionGraceDays(),
): Date {
  return new Date(scheduledAt.getTime() + days * DAY_MS);
}
