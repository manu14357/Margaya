import { eq, min } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cycleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { findOverlappingCycle } from "../queries";
import {
  assertOwner,
  getCycleResponse,
  lockProject,
  OVERLAP_MESSAGE,
  resolveDatePair,
} from "./shared";

// New cycles go first: below the project's lowest sort order.
const FIRST_SORT_ORDER = 65535;
const SORT_ORDER_STEP = 10000;

async function createCycle({
  projectId,
  workspaceId,
  userId,
  name,
  description,
  startDate,
  endDate,
  ownerId,
}: {
  projectId: string;
  workspaceId: string;
  userId: string;
  name: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string;
}) {
  const dates = resolveDatePair(startDate ?? null, endDate ?? null) ?? {
    startDate: null,
    endDate: null,
  };
  if (ownerId !== undefined && ownerId !== userId) {
    await assertOwner(ownerId, workspaceId);
  }

  const created = await db.transaction(async (tx) => {
    await lockProject(tx, projectId);

    if (dates.startDate && dates.endDate) {
      const overlap = await findOverlappingCycle(tx, {
        projectId,
        startDate: dates.startDate,
        endDate: dates.endDate,
      });
      if (overlap) throw new HTTPException(409, { message: OVERLAP_MESSAGE });
    }

    const [lowest] = await tx
      .select({ sortOrder: min(cycleTable.sortOrder) })
      .from(cycleTable)
      .where(eq(cycleTable.projectId, projectId));
    const lowestSortOrder = lowest?.sortOrder;

    const [row] = await tx
      .insert(cycleTable)
      .values({
        projectId,
        name,
        description: description ?? "",
        startDate: dates.startDate,
        endDate: dates.endDate,
        ownerId: ownerId ?? userId,
        createdBy: userId,
        sortOrder:
          lowestSortOrder === null || lowestSortOrder === undefined
            ? FIRST_SORT_ORDER
            : Number(lowestSortOrder) - SORT_ORDER_STEP,
      })
      .returning();
    if (!row) {
      throw new HTTPException(500, { message: "Failed to create the cycle" });
    }
    return row;
  });

  await publishEvent("cycle.created", {
    cycleId: created.id,
    projectId,
    userId,
    name: created.name,
  });

  return getCycleResponse(created.id);
}

export default createCycle;
