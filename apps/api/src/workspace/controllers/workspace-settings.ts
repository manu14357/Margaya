import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, workspaceTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  isValidTimezone,
  normalizeTimezone,
  resolveTimezone,
} from "../../utils/timezone";

export const INVALID_TIMEZONE = "Unknown time zone";

export async function getWorkspaceSettings(workspaceId: string) {
  const [row] = await db
    .select({
      timezone: workspaceTable.timezone,
      allowPublicPages: workspaceTable.allowPublicPages,
      allowA2a: workspaceTable.allowA2a,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Workspace not found" });
  return {
    timezone: resolveTimezone(row.timezone),
    allowPublicPages: row.allowPublicPages,
    allowA2a: row.allowA2a,
  };
}

export async function updateWorkspaceSettings({
  workspaceId,
  userId,
  timezone,
  allowPublicPages,
  allowA2a,
}: {
  workspaceId: string;
  userId: string;
  timezone?: string;
  allowPublicPages?: boolean;
  allowA2a?: boolean;
}) {
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    throw new HTTPException(400, { message: INVALID_TIMEZONE });
  }
  const before = await getWorkspaceSettings(workspaceId);
  const next = {
    timezone:
      timezone === undefined ? before.timezone : normalizeTimezone(timezone),
    allowPublicPages: allowPublicPages ?? before.allowPublicPages,
    allowA2a: allowA2a ?? before.allowA2a,
  };
  const changed = (
    ["timezone", "allowPublicPages", "allowA2a"] as const
  ).filter((key) => before[key] !== next[key]);
  if (changed.length === 0) return before;

  const revokedPageIds = await db.transaction(async (tx) => {
    await tx
      .update(workspaceTable)
      .set(next)
      .where(eq(workspaceTable.id, workspaceId));
    if (next.allowPublicPages) return [];
    // Turning public pages off revokes every link; publishing again issues
    // new ones.
    const revoked = await tx
      .update(pageTable)
      .set({ publicToken: null, publishedAt: null, publishedById: null })
      .where(
        and(
          eq(pageTable.workspaceId, workspaceId),
          isNotNull(pageTable.publicToken),
        ),
      )
      .returning({ id: pageTable.id });
    return revoked.map((row) => row.id);
  });

  await publishEvent("workspace.settings_updated", {
    workspaceId,
    userId,
    changed,
  });
  if (changed.includes("allowPublicPages")) {
    await publishEvent("workspace.public_pages_changed", {
      workspaceId,
      userId,
      allowPublicPages: next.allowPublicPages,
      revokedPageIds,
    });
  }
  return next;
}
