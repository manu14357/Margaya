import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  isValidTimezone,
  normalizeTimezone,
  resolveTimezone,
} from "../../utils/timezone";

export const INVALID_TIMEZONE = "Unknown time zone";

export async function getWorkspaceSettings(workspaceId: string) {
  const [row] = await db
    .select({ timezone: workspaceTable.timezone })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Workspace not found" });
  return { timezone: resolveTimezone(row.timezone) };
}

export async function updateWorkspaceSettings({
  workspaceId,
  userId,
  timezone,
}: {
  workspaceId: string;
  userId: string;
  timezone: string;
}) {
  if (!isValidTimezone(timezone)) {
    throw new HTTPException(400, { message: INVALID_TIMEZONE });
  }
  const next = normalizeTimezone(timezone);
  const before = await getWorkspaceSettings(workspaceId);
  if (before.timezone === next) return before;

  await db
    .update(workspaceTable)
    .set({ timezone: next })
    .where(eq(workspaceTable.id, workspaceId));

  await publishEvent("workspace.settings_updated", {
    workspaceId,
    userId,
    changed: ["timezone"],
  });
  return { timezone: next };
}
