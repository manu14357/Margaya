import { HTTPException } from "hono/http-exception";
import { getEstimateResponse, pointsOf, requireEstimate } from "../queries";
import { estimateWrite, lockProjectEstimates } from "../write";
import { publishEstimateEvent, touchEstimate, writePositions } from "./shared";

/**
 * Puts a categories system's values in the given order. Points and time are
 * always ordered by value, so reordering them is refused.
 */
async function reorderEstimatePoints({
  projectId,
  estimateId,
  userId,
  pointIds,
}: {
  projectId: string;
  estimateId: string;
  userId: string;
  pointIds: string[];
}) {
  const { response, changed } = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    if (estimate.type !== "categories") {
      throw new HTTPException(400, {
        message:
          "Only category values can be reordered; points and time stay sorted by value",
      });
    }

    const points = await pointsOf(tx, estimateId);
    const byId = new Map(points.map((point) => [point.id, point]));
    const ordered = pointIds.flatMap((id) => {
      const point = byId.get(id);
      return point ? [point] : [];
    });
    if (
      ordered.length !== points.length ||
      pointIds.length !== points.length ||
      new Set(pointIds).size !== pointIds.length
    ) {
      throw new HTTPException(400, {
        message: "Send every value of the estimate system exactly once",
      });
    }

    const changed = await writePositions(tx, estimate.type, ordered);
    if (changed) await touchEstimate(tx, estimateId);
    return {
      response: await getEstimateResponse(tx, projectId, estimateId),
      changed,
    };
  });

  if (changed) {
    await publishEstimateEvent("estimate.updated", {
      projectId,
      estimateId,
      userId,
    });
  }
  return response;
}

export default reorderEstimatePoints;
