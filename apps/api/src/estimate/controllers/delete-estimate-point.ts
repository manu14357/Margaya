import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { estimatePointTable } from "../../database/schema";
import {
  getEstimateResponse,
  pointsOf,
  requireEstimate,
  requirePoint,
  snapshotOf,
  taskCountsByPoint,
} from "../queries";
import { remapPoints } from "../remap";
import { MIN_ESTIMATE_POINTS } from "../validate-points";
import { estimateWrite, jsonHttpError, lockProjectEstimates } from "../write";
import {
  publishEstimateEvent,
  publishTasksRemapped,
  touchEstimate,
  writePositions,
} from "./shared";

/**
 * Deletes a value. Its tasks move to `replacementPointId` (another value of
 * the same system) or lose their estimate with `clear`; with tasks on it and
 * neither option, nothing changes and the answer carries the task count.
 * Every check runs before any write.
 */
async function deleteEstimatePoint({
  projectId,
  estimateId,
  pointId,
  userId,
  replacementPointId,
  clear,
}: {
  projectId: string;
  estimateId: string;
  pointId: string;
  userId: string;
  replacementPointId?: string;
  clear: boolean;
}) {
  if (replacementPointId && clear) {
    throw new HTTPException(400, {
      message: "Send either replacementPointId or clear=true, not both",
    });
  }

  const outcome = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    const points = await pointsOf(tx, estimateId);
    const point = requirePoint(points, pointId);
    if (points.length <= MIN_ESTIMATE_POINTS) {
      throw new HTTPException(409, {
        message: `An estimate system needs at least ${MIN_ESTIMATE_POINTS} values`,
      });
    }

    let replacement: (typeof points)[number] | null = null;
    if (replacementPointId) {
      if (replacementPointId === pointId) {
        throw new HTTPException(400, {
          message: "The replacement must be another value",
        });
      }
      replacement =
        points.find((candidate) => candidate.id === replacementPointId) ?? null;
      if (!replacement) {
        throw new HTTPException(400, {
          message:
            "The replacement must be a value of the same estimate system",
        });
      }
    }

    const taskCount =
      (await taskCountsByPoint(tx, [pointId])).get(pointId) ?? 0;
    if (taskCount > 0 && !replacement && !clear) {
      throw jsonHttpError(409, {
        message:
          "Tasks use this estimate value; choose a replacement or clear their estimate",
        taskCount,
      });
    }

    const counts = await remapPoints(tx, {
      projectId,
      userId,
      reason: "point_deleted",
      plan:
        taskCount > 0
          ? [
              {
                from: snapshotOf(estimate, point),
                to: replacement ? snapshotOf(estimate, replacement) : null,
              },
            ]
          : [],
    });

    await tx
      .delete(estimatePointTable)
      .where(eq(estimatePointTable.id, pointId));
    await writePositions(
      tx,
      estimate.type,
      points.filter((other) => other.id !== pointId),
    );
    await touchEstimate(tx, estimateId);

    return {
      estimate: await getEstimateResponse(tx, projectId, estimateId),
      ...counts,
    };
  });

  await publishEstimateEvent("estimate.updated", {
    projectId,
    estimateId,
    userId,
  });
  await publishTasksRemapped({
    projectId,
    estimateId,
    userId,
    changedTaskCount: outcome.movedTaskCount + outcome.clearedTaskCount,
  });
  return outcome;
}

export default deleteEstimatePoint;
