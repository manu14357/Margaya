import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cycleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { projectToday } from "../../utils/timezone";
import { deriveCycleStatus } from "../dates";
import { getCycleResponse, lockCycle } from "./shared";

// Favorites of an archived cycle are kept: the entity registry hides them
// while it is archived and shows them again after a restore.

export async function archiveCycle(cycleId: string, userId: string) {
  const cycle = await db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.archivedAt) {
      throw new HTTPException(409, {
        message: "The cycle is already archived",
      });
    }
    const today = await projectToday(cycle.projectId, tx);
    if (deriveCycleStatus(cycle, today) !== "completed") {
      throw new HTTPException(409, {
        message: "Only completed cycles can be archived",
      });
    }
    await tx
      .update(cycleTable)
      .set({ archivedAt: new Date() })
      .where(eq(cycleTable.id, cycleId));
    return cycle;
  });

  await publishEvent("cycle.archived", {
    cycleId,
    projectId: cycle.projectId,
    userId,
  });
  return getCycleResponse(cycleId);
}

export async function unarchiveCycle(cycleId: string, userId: string) {
  const cycle = await db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (!cycle.archivedAt) {
      throw new HTTPException(409, { message: "The cycle is not archived" });
    }
    await tx
      .update(cycleTable)
      .set({ archivedAt: null })
      .where(eq(cycleTable.id, cycleId));
    return cycle;
  });

  await publishEvent("cycle.unarchived", {
    cycleId,
    projectId: cycle.projectId,
    userId,
  });
  return getCycleResponse(cycleId);
}
