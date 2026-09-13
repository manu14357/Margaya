import { and, asc, eq } from "drizzle-orm";
import { stickyTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  type StickyColor,
} from "../colors";

type StickyRow = typeof stickyTable.$inferSelect;

export const STICKY_NOT_FOUND = "Sticky not found";

export function ownStickies(userId: string, workspaceId: string) {
  return and(
    eq(stickyTable.userId, userId),
    eq(stickyTable.workspaceId, workspaceId),
  );
}

export const stickyOrder = [asc(stickyTable.position), asc(stickyTable.id)];

function toStickyColor(value: string): StickyColor {
  return (STICKY_COLORS as readonly string[]).includes(value)
    ? (value as StickyColor)
    : DEFAULT_STICKY_COLOR;
}

/** The public shape: never the owner id or the search projection. */
export function toSticky(row: StickyRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    content: row.content,
    color: toStickyColor(row.color),
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type StickyChange = "created" | "updated" | "deleted" | "reordered";

// Ids only: sticky content never travels through events.
export async function publishStickyChanged(
  userId: string,
  workspaceId: string,
  stickyId: string | null,
  action: StickyChange,
) {
  await publishEvent("sticky.changed", {
    userId,
    workspaceId,
    stickyId,
    action,
  });
}
