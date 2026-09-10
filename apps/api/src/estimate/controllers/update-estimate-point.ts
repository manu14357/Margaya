import { eq } from "drizzle-orm";
import { estimatePointTable } from "../../database/schema";
import {
  getEstimateResponse,
  pointsOf,
  requireEstimate,
  requirePoint,
} from "../queries";
import { validateEstimateValue } from "../validate-points";
import { estimateWrite, lockProjectEstimates } from "../write";
import {
  invalidValues,
  publishEstimateEvent,
  touchEstimate,
  writePositions,
} from "./shared";

/**
 * Changes a value's text. Tasks keep the same point, so they show the new
 * value; this is a system edit and writes no task history. Numeric systems
 * re-sort by value.
 */
async function updateEstimatePoint({
  projectId,
  estimateId,
  pointId,
  userId,
  value,
}: {
  projectId: string;
  estimateId: string;
  pointId: string;
  userId: string;
  value: string;
}) {
  const { response, changed } = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    const points = await pointsOf(tx, estimateId);
    const point = requirePoint(points, pointId);

    const validated = validateEstimateValue(
      estimate.type,
      value,
      points.filter((other) => other.id !== pointId),
    );
    if (!validated.ok) throw invalidValues([validated.error]);

    const changed = validated.point.value !== point.value;
    if (changed) {
      await tx
        .update(estimatePointTable)
        .set(validated.point)
        .where(eq(estimatePointTable.id, pointId));
      await writePositions(
        tx,
        estimate.type,
        points.map((other) =>
          other.id === pointId ? { ...other, ...validated.point } : other,
        ),
      );
      await touchEstimate(tx, estimateId);
    }
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

export default updateEstimatePoint;
