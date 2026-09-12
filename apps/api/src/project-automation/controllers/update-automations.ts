import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, projectAutomationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type AutomationPatch,
  hasAutomationChanges,
  mergeAutomationPatch,
} from "../settings";
import {
  getProjectAutomations,
  loadAutomationRow,
  settingsOf,
} from "./get-automations";

export const CHOOSE_CANCELLED_COLUMN =
  "Choose a column in the Cancelled group of this project";

async function isCancelledColumnOf(columnId: string, projectId: string) {
  const [column] = await db
    .select({ group: columnTable.group })
    .from(columnTable)
    .where(
      and(eq(columnTable.id, columnId), eq(columnTable.projectId, projectId)),
    )
    .limit(1);
  return column?.group === "cancelled";
}

/**
 * Applies a settings PATCH (§3.3.3) and upserts the row. A patch that
 * changes nothing writes and publishes nothing.
 */
export async function updateProjectAutomations({
  projectId,
  workspaceId,
  userId,
  patch,
}: {
  projectId: string;
  workspaceId: string;
  userId: string;
  patch: AutomationPatch;
}) {
  if (!hasAutomationChanges(patch)) {
    throw new HTTPException(400, {
      message: "Provide at least one setting to change",
    });
  }

  const current = settingsOf(await loadAutomationRow(projectId));
  const { next, changed } = mergeAutomationPatch(current, patch);

  const sentColumn = patch.autoClose?.columnId;
  if (sentColumn && !(await isCancelledColumnOf(sentColumn, projectId))) {
    throw new HTTPException(400, { message: CHOOSE_CANCELLED_COLUMN });
  }
  // Touching auto-close must leave it with a valid column while it is on;
  // other writes may leave a paused rule alone.
  if (patch.autoClose && next.autoCloseEnabled) {
    const valid =
      next.autoCloseColumnId !== null &&
      (next.autoCloseColumnId === sentColumn ||
        (await isCancelledColumnOf(next.autoCloseColumnId, projectId)));
    if (!valid) {
      throw new HTTPException(400, { message: CHOOSE_CANCELLED_COLUMN });
    }
  }

  if (changed.length > 0) {
    await db
      .insert(projectAutomationTable)
      .values({ projectId, ...next, updatedBy: userId })
      .onConflictDoUpdate({
        target: projectAutomationTable.projectId,
        set: { ...next, updatedBy: userId, updatedAt: new Date() },
      });
    await publishEvent("project.automations_updated", {
      projectId,
      workspaceId,
      userId,
      changed,
    });
  }

  return getProjectAutomations(projectId);
}
