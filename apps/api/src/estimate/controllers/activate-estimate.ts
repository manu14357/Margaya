import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { estimateTable } from "../../database/schema";
import {
  type EstimatePointRecord,
  type EstimateRecord,
  findActiveEstimate,
  getEstimateResponse,
  pointsOf,
  requireEstimate,
  snapshotOf,
  taskCountsByPoint,
} from "../queries";
import { type PointSnapshot, remapPoints } from "../remap";
import { estimateWrite, lockProjectEstimates } from "../write";
import { publishEstimateEvent, publishTasksRemapped } from "./shared";

export type PointMapping = { fromPointId: string; toPointId: string | null };

type SwitchPlan = Array<{ from: PointSnapshot; to: PointSnapshot | null }>;

/**
 * Checks a switch mapping and turns it into a remap plan with one entry per
 * value of the current system: its mapped target, or null when unmapped.
 * Everything is validated before any write.
 */
export function planSwitch({
  mapping,
  current,
  currentPoints,
  target,
  targetPoints,
}: {
  mapping: readonly PointMapping[];
  current: Pick<EstimateRecord, "type"> | null;
  currentPoints: readonly EstimatePointRecord[];
  target: Pick<EstimateRecord, "type">;
  targetPoints: readonly EstimatePointRecord[];
}): SwitchPlan {
  if (!current) {
    if (mapping.length > 0) {
      throw new HTTPException(400, { message: "Nothing to map" });
    }
    return [];
  }

  const targets = new Map<string, string | null>();
  for (const { fromPointId, toPointId } of mapping) {
    if (targets.has(fromPointId)) {
      throw new HTTPException(400, {
        message: "Each value can be mapped only once",
      });
    }
    if (!currentPoints.some((point) => point.id === fromPointId)) {
      throw new HTTPException(400, {
        message: "Mapped values must belong to the active estimate system",
      });
    }
    if (
      toPointId !== null &&
      !targetPoints.some((point) => point.id === toPointId)
    ) {
      throw new HTTPException(400, {
        message:
          "Values must map to the estimate system being activated, or to null",
      });
    }
    targets.set(fromPointId, toPointId);
  }

  return currentPoints.map((point) => {
    const toId = targets.get(point.id) ?? null;
    const to = toId
      ? targetPoints.find((candidate) => candidate.id === toId)
      : null;
    return {
      from: snapshotOf(current, point),
      to: to ? snapshotOf(target, to) : null,
    };
  });
}

/**
 * Makes a system the project's active one. The tasks on the old system's
 * values move as mapped (unmapped ones lose their estimate), with history,
 * in the same transaction. The old system stays, inactive, and can be
 * switched back to. Activating the active system changes nothing.
 */
async function activateEstimate({
  projectId,
  estimateId,
  userId,
  mapping,
}: {
  projectId: string;
  estimateId: string;
  userId: string;
  mapping: readonly PointMapping[];
}) {
  const outcome = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const target = await requireEstimate(tx, projectId, estimateId);
    if (target.isActive) {
      return {
        estimate: await getEstimateResponse(tx, projectId, estimateId),
        previousEstimateId: target.id,
        remappedTaskCount: 0,
        clearedTaskCount: 0,
        changed: false,
      };
    }

    const current = await findActiveEstimate(tx, projectId);
    const currentPoints = current ? await pointsOf(tx, current.id) : [];
    const plan = planSwitch({
      mapping,
      current,
      currentPoints,
      target,
      targetPoints: await pointsOf(tx, target.id),
    });

    const counts = await taskCountsByPoint(
      tx,
      currentPoints.map((point) => point.id),
    );
    const { movedTaskCount, clearedTaskCount } = await remapPoints(tx, {
      projectId,
      userId,
      reason: "system_switched",
      plan: plan.filter(({ from }) => (counts.get(from.id) ?? 0) > 0),
    });

    // The old system goes inactive first: the partial unique index allows
    // one active system per project at any moment.
    if (current) {
      await tx
        .update(estimateTable)
        .set({ isActive: false })
        .where(eq(estimateTable.id, current.id));
    }
    await tx
      .update(estimateTable)
      .set({ isActive: true })
      .where(eq(estimateTable.id, target.id));

    return {
      estimate: await getEstimateResponse(tx, projectId, estimateId),
      previousEstimateId: current?.id ?? null,
      remappedTaskCount: movedTaskCount,
      clearedTaskCount,
      changed: true,
    };
  });

  const { changed, ...result } = outcome;
  if (changed) {
    await publishEstimateEvent("estimate.activated", {
      projectId,
      estimateId,
      userId,
    });
    await publishTasksRemapped({
      projectId,
      estimateId,
      userId,
      changedTaskCount: result.remappedTaskCount + result.clearedTaskCount,
    });
  }
  return result;
}

export default activateEstimate;
