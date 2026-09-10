import { estimatePointTable, estimateTable } from "../../database/schema";
import { arrangePoints } from "../positions";
import { findActiveEstimate, toEstimate } from "../queries";
import type { EstimateType } from "../types";
import { validateEstimateValues } from "../validate-points";
import { estimateWrite, lockProjectEstimates } from "../write";
import {
  assertNameAvailable,
  invalidValues,
  publishEstimateEvent,
} from "./shared";

/**
 * Creates a system with its values. Every value is validated before anything
 * is written. The first system of a project becomes active; later ones stay
 * inactive until switched to.
 */
async function createEstimate({
  projectId,
  userId,
  name,
  type,
  values,
}: {
  projectId: string;
  userId: string;
  name: string;
  type: EstimateType;
  values: string[];
}) {
  const validated = validateEstimateValues(type, values);
  if (!validated.ok) throw invalidValues(validated.errors);

  const created = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    await assertNameAvailable(tx, projectId, name);
    const active = await findActiveEstimate(tx, projectId);

    const [estimate] = await tx
      .insert(estimateTable)
      .values({
        projectId,
        name,
        type,
        isActive: active === null,
        createdBy: userId,
      })
      .returning();
    if (!estimate) throw new Error("Failed to create the estimate system");

    const points = await tx
      .insert(estimatePointTable)
      .values(
        arrangePoints(type, validated.points).map((point) => ({
          estimateId: estimate.id,
          value: point.value,
          numericValue: point.numericValue,
          position: point.position,
        })),
      )
      .returning();
    points.sort((a, b) => a.position - b.position);
    return toEstimate(estimate, points, new Map());
  });

  const event = { projectId, estimateId: created.id, userId };
  await publishEstimateEvent("estimate.created", event);
  if (created.isActive) {
    await publishEstimateEvent("estimate.activated", event);
  }
  return created;
}

export default createEstimate;
