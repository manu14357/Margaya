// TRASH_RETENTION_DAYS (C7): days a trashed task, project or page is kept before
// the auto purge deletes it permanently. 0 turns the auto purge off.

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MAX_TRASH_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trashRetentionDays(
  raw: string | undefined = process.env.TRASH_RETENTION_DAYS,
): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return DEFAULT_TRASH_RETENTION_DAYS;
  return Math.min(MAX_TRASH_RETENTION_DAYS, Number.parseInt(trimmed, 10));
}

/** When an item deleted at `deletedAt` is purged; null when disabled. */
export function purgeAtFor(
  deletedAt: Date,
  days: number = trashRetentionDays(),
): Date | null {
  return days > 0 ? new Date(deletedAt.getTime() + days * DAY_MS) : null;
}

/** Items deleted before this are due; null when the auto purge is off. */
export function purgeCutoff(
  now: Date,
  days: number = trashRetentionDays(),
): Date | null {
  return days > 0 ? new Date(now.getTime() - days * DAY_MS) : null;
}
