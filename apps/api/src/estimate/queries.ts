import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  estimatePointTable,
  estimateTable,
  taskTable,
} from "../database/schema";
import type { Reader } from "../task/progress-queries";
import type { PointSnapshot } from "./remap";

export type { Reader };
export type EstimateRecord = typeof estimateTable.$inferSelect;
export type EstimatePointRecord = typeof estimatePointTable.$inferSelect;

export const ESTIMATE_NOT_FOUND = "Estimate not found";
export const ESTIMATE_POINT_NOT_FOUND = "Estimate point not found";

/**
 * The estimate, when it belongs to the project in the path. Anything else
 * (unknown, or another project's) is a 404: the cross-tenant guard.
 */
export async function requireEstimate(
  reader: Reader,
  projectId: string,
  estimateId: string,
): Promise<EstimateRecord> {
  const [estimate] = await reader
    .select()
    .from(estimateTable)
    .where(
      and(
        eq(estimateTable.id, estimateId),
        eq(estimateTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!estimate) throw new HTTPException(404, { message: ESTIMATE_NOT_FOUND });
  return estimate;
}

/** The project's active estimate system, or null. */
export async function findActiveEstimate(
  reader: Reader,
  projectId: string,
): Promise<EstimateRecord | null> {
  const [estimate] = await reader
    .select()
    .from(estimateTable)
    .where(
      and(
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.isActive, true),
      ),
    )
    .limit(1);
  return estimate ?? null;
}

/** A system's points in position order. */
export async function pointsOf(
  reader: Reader,
  estimateId: string,
): Promise<EstimatePointRecord[]> {
  return reader
    .select()
    .from(estimatePointTable)
    .where(eq(estimatePointTable.estimateId, estimateId))
    .orderBy(asc(estimatePointTable.position), asc(estimatePointTable.id));
}

/** The point, when it belongs to the listed system; 404 otherwise. */
export function requirePoint(
  points: readonly EstimatePointRecord[],
  pointId: string,
): EstimatePointRecord {
  const point = points.find((candidate) => candidate.id === pointId);
  if (!point) {
    throw new HTTPException(404, { message: ESTIMATE_POINT_NOT_FOUND });
  }
  return point;
}

export function snapshotOf(
  estimate: Pick<EstimateRecord, "type">,
  point: Pick<EstimatePointRecord, "id" | "value">,
): PointSnapshot {
  return { id: point.id, value: point.value, type: estimate.type };
}

/** How many tasks, archived ones included, sit on each of the points. */
export async function taskCountsByPoint(
  reader: Reader,
  pointIds: readonly string[],
): Promise<Map<string, number>> {
  if (pointIds.length === 0) return new Map();
  const rows = await reader
    .select({ pointId: taskTable.estimatePointId, taskCount: count() })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.estimatePointId, [...pointIds]),
        // Trashed tasks read as gone (C7).
        isNull(taskTable.deletedAt),
      ),
    )
    .groupBy(taskTable.estimatePointId);
  return new Map(
    rows.flatMap((row) =>
      row.pointId ? [[row.pointId, Number(row.taskCount)] as const] : [],
    ),
  );
}

export function toEstimate(
  estimate: EstimateRecord,
  points: readonly EstimatePointRecord[],
  taskCounts: ReadonlyMap<string, number>,
) {
  return {
    id: estimate.id,
    projectId: estimate.projectId,
    name: estimate.name,
    type: estimate.type,
    isActive: estimate.isActive,
    createdAt: estimate.createdAt,
    updatedAt: estimate.updatedAt,
    points: points.map((point) => ({
      id: point.id,
      estimateId: point.estimateId,
      value: point.value,
      numericValue: point.numericValue,
      position: point.position,
      taskCount: taskCounts.get(point.id) ?? 0,
    })),
  };
}

export type EstimateResponse = ReturnType<typeof toEstimate>;

/** One system with its points and their task counts, read fresh. */
export async function getEstimateResponse(
  reader: Reader,
  projectId: string,
  estimateId: string,
): Promise<EstimateResponse> {
  const estimate = await requireEstimate(reader, projectId, estimateId);
  const points = await pointsOf(reader, estimate.id);
  const counts = await taskCountsByPoint(
    reader,
    points.map((point) => point.id),
  );
  return toEstimate(estimate, points, counts);
}

/** Every system of the project: the active one first, then newest first. */
export async function listEstimates(reader: Reader, projectId: string) {
  const estimates = await reader
    .select()
    .from(estimateTable)
    .where(eq(estimateTable.projectId, projectId))
    .orderBy(
      desc(estimateTable.isActive),
      desc(estimateTable.createdAt),
      asc(estimateTable.id),
    );

  const ids = estimates.map((estimate) => estimate.id);
  const points =
    ids.length === 0
      ? []
      : await reader
          .select()
          .from(estimatePointTable)
          .where(inArray(estimatePointTable.estimateId, ids))
          .orderBy(
            asc(estimatePointTable.position),
            asc(estimatePointTable.id),
          );
  const counts = await taskCountsByPoint(
    reader,
    points.map((point) => point.id),
  );

  const pointsByEstimate = new Map<string, EstimatePointRecord[]>();
  for (const point of points) {
    const list = pointsByEstimate.get(point.estimateId) ?? [];
    list.push(point);
    pointsByEstimate.set(point.estimateId, list);
  }

  return {
    activeEstimateId:
      estimates.find((estimate) => estimate.isActive)?.id ?? null,
    estimates: estimates.map((estimate) =>
      toEstimate(estimate, pointsByEstimate.get(estimate.id) ?? [], counts),
    ),
  };
}
