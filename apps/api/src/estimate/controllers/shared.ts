import { and, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { estimatePointTable, estimateTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { arrangePoints } from "../positions";
import type { EstimatePointRecord, Reader } from "../queries";
import type { EstimateType } from "../types";
import type { EstimateValueError } from "../validate-points";
import { ESTIMATE_NAME_TAKEN, jsonHttpError, type Transaction } from "../write";

export type EstimateEvent =
  | "estimate.created"
  | "estimate.updated"
  | "estimate.deleted"
  | "estimate.activated";

/** A refetch hint for the project's estimate list; never entity data. */
export async function publishEstimateEvent(
  event: EstimateEvent,
  data: { projectId: string; estimateId: string; userId: string },
) {
  await publishEvent(event, data);
}

/** One project-level hint after a remap, however many tasks changed. */
export async function publishTasksRemapped(data: {
  projectId: string;
  estimateId: string;
  userId: string;
  changedTaskCount: number;
}) {
  if (data.changedTaskCount === 0) return;
  await publishEvent("estimate.tasks_remapped", data);
}

/** 400 with one entry per offending value, before anything is written. */
export function invalidValues(errors: EstimateValueError[]) {
  return jsonHttpError(400, { message: "Invalid estimate values", errors });
}

/** Names are unique per project, ignoring case. */
export async function assertNameAvailable(
  reader: Reader,
  projectId: string,
  name: string,
  exceptEstimateId?: string,
) {
  const [conflict] = await reader
    .select({ id: estimateTable.id })
    .from(estimateTable)
    .where(
      and(
        eq(estimateTable.projectId, projectId),
        sql`lower(${estimateTable.name}) = lower(${name})`,
        exceptEstimateId ? ne(estimateTable.id, exceptEstimateId) : undefined,
      ),
    )
    .limit(1);
  if (conflict) throw new HTTPException(409, { message: ESTIMATE_NAME_TAKEN });
}

/**
 * Stores the positions a system's points should have, given them in their
 * intended order (numeric systems are re-sorted by value). Only rows whose
 * position changes are written. Returns whether anything changed.
 */
export async function writePositions(
  tx: Transaction,
  type: EstimateType,
  points: readonly Pick<
    EstimatePointRecord,
    "id" | "numericValue" | "position"
  >[],
): Promise<boolean> {
  const stored = new Map(points.map((point) => [point.id, point.position]));
  let changed = false;
  for (const point of arrangePoints(type, points)) {
    if (stored.get(point.id) === point.position) continue;
    changed = true;
    await tx
      .update(estimatePointTable)
      .set({ position: point.position })
      .where(eq(estimatePointTable.id, point.id));
  }
  return changed;
}

/** Marks the system as changed when only its points were written. */
export async function touchEstimate(tx: Transaction, estimateId: string) {
  await tx
    .update(estimateTable)
    .set({ updatedAt: new Date() })
    .where(eq(estimateTable.id, estimateId));
}
