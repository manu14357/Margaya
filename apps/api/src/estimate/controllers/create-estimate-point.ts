import { HTTPException } from "hono/http-exception";
import { estimatePointTable } from "../../database/schema";
import { insertAtPosition } from "../positions";
import { getEstimateResponse, pointsOf, requireEstimate } from "../queries";
import { MAX_ESTIMATE_POINTS, validateEstimateValue } from "../validate-points";
import { estimateWrite, lockProjectEstimates } from "../write";
import {
  invalidValues,
  publishEstimateEvent,
  touchEstimate,
  writePositions,
} from "./shared";

/**
 * Adds a value to a system. Points and time slot in by value; a category
 * goes to the requested position, or last.
 */
async function createEstimatePoint({
  projectId,
  estimateId,
  userId,
  value,
  position,
}: {
  projectId: string;
  estimateId: string;
  userId: string;
  value: string;
  position?: number;
}) {
  const response = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    const points = await pointsOf(tx, estimateId);
    if (points.length >= MAX_ESTIMATE_POINTS) {
      throw new HTTPException(409, {
        message: `An estimate system can have at most ${MAX_ESTIMATE_POINTS} values`,
      });
    }

    const validated = validateEstimateValue(estimate.type, value, points);
    if (!validated.ok) throw invalidValues([validated.error]);

    const [inserted] = await tx
      .insert(estimatePointTable)
      .values({
        estimateId,
        value: validated.point.value,
        numericValue: validated.point.numericValue,
        position: points.length + 1,
      })
      .returning();
    if (!inserted) throw new Error("Failed to add the estimate value");

    await writePositions(
      tx,
      estimate.type,
      estimate.type === "categories"
        ? insertAtPosition(points, inserted, position)
        : [...points, inserted],
    );
    await touchEstimate(tx, estimateId);
    return getEstimateResponse(tx, projectId, estimateId);
  });

  await publishEstimateEvent("estimate.updated", {
    projectId,
    estimateId,
    userId,
  });
  return response;
}

export default createEstimatePoint;
