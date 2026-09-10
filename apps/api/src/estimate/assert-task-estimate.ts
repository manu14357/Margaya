import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { estimatePointTable, estimateTable } from "../database/schema";
import type { Reader } from "../task/progress-queries";
import type { PointSnapshot } from "./remap";

export const POINT_NOT_IN_ACTIVE_SYSTEM =
  "Estimate point does not belong to this project's active estimate system";

/**
 * The point's snapshot when it belongs to the active estimate system of the
 * project; 400 otherwise. Callers hold the shared estimate lock, so the
 * answer stays true until they commit.
 */
export async function assertTaskEstimatePoint(
  projectId: string,
  pointId: string,
  tx: Reader,
): Promise<PointSnapshot> {
  const [point] = await tx
    .select({
      id: estimatePointTable.id,
      value: estimatePointTable.value,
      type: estimateTable.type,
    })
    .from(estimatePointTable)
    .innerJoin(
      estimateTable,
      eq(estimateTable.id, estimatePointTable.estimateId),
    )
    .where(
      and(
        eq(estimatePointTable.id, pointId),
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.isActive, true),
      ),
    )
    .limit(1);
  if (!point) {
    throw new HTTPException(400, { message: POINT_NOT_IN_ACTIVE_SYSTEM });
  }
  return point;
}

/** Snapshots of the given points, whatever system they belong to. */
export async function pointSnapshots(
  tx: Reader,
  pointIds: readonly string[],
): Promise<Map<string, PointSnapshot>> {
  if (pointIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: estimatePointTable.id,
      value: estimatePointTable.value,
      type: estimateTable.type,
    })
    .from(estimatePointTable)
    .innerJoin(
      estimateTable,
      eq(estimateTable.id, estimatePointTable.estimateId),
    )
    .where(inArray(estimatePointTable.id, [...pointIds]));
  return new Map(rows.map((row) => [row.id, row]));
}
