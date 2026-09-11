import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleTable } from "../../database/schema";
import { removeEntityReferences } from "../../entity-reference/registry";
import { publishEvent } from "../../events";
import { ARCHIVABLE_MODULE_STATUSES } from "../types";
import { getModuleResponse, lockModule } from "./shared";

// Archiving keeps the status and is idempotent: archiving an archived module,
// or restoring an active one, answers the module unchanged with no event.

export async function archiveModule(moduleId: string, userId: string) {
  const archived = await db.transaction(async (tx) => {
    const current = await lockModule(tx, moduleId);
    if (current.archivedAt) return null;
    if (!ARCHIVABLE_MODULE_STATUSES.includes(current.status)) {
      throw new HTTPException(400, {
        message: "Only completed or cancelled modules can be archived",
      });
    }
    await tx
      .update(moduleTable)
      .set({ archivedAt: new Date() })
      .where(eq(moduleTable.id, moduleId));
    return current;
  });

  if (archived) {
    // Archived modules leave pickers and lists, and their favorites and
    // recent visits go with them.
    await removeEntityReferences("module", [moduleId]);
    await publishEvent("module.archived", {
      moduleId,
      projectId: archived.projectId,
      userId,
    });
  }
  return getModuleResponse(moduleId);
}

export async function unarchiveModule(moduleId: string, userId: string) {
  const restored = await db.transaction(async (tx) => {
    const current = await lockModule(tx, moduleId);
    if (!current.archivedAt) return null;
    await tx
      .update(moduleTable)
      .set({ archivedAt: null })
      .where(eq(moduleTable.id, moduleId));
    return current;
  });

  if (restored) {
    await publishEvent("module.unarchived", {
      moduleId,
      projectId: restored.projectId,
      userId,
    });
  }
  return getModuleResponse(moduleId);
}
