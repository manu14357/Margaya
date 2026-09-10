import { eq } from "drizzle-orm";
import { estimateTable } from "../../database/schema";
import {
  pointsOf,
  requireEstimate,
  snapshotOf,
  taskCountsByPoint,
} from "../queries";
import { remapPoints } from "../remap";
import { estimateWrite, lockProjectEstimates } from "../write";
import { publishEstimateEvent, publishTasksRemapped } from "./shared";

/**
 * Deletes a system and its values. Tasks on its values (only an active
 * system has any) lose their estimate first, with history. No other system
 * is promoted: the project is left without an active one.
 */
async function deleteEstimate({
  projectId,
  estimateId,
  userId,
}: {
  projectId: string;
  estimateId: string;
  userId: string;
}) {
  const { clearedTaskCount } = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    const points = await pointsOf(tx, estimateId);
    const counts = await taskCountsByPoint(
      tx,
      points.map((point) => point.id),
    );
    const { clearedTaskCount } = await remapPoints(tx, {
      projectId,
      userId,
      reason: "system_deleted",
      plan: points
        .filter((point) => (counts.get(point.id) ?? 0) > 0)
        .map((point) => ({ from: snapshotOf(estimate, point), to: null })),
    });
    await tx.delete(estimateTable).where(eq(estimateTable.id, estimateId));
    return { clearedTaskCount };
  });

  await publishEstimateEvent("estimate.deleted", {
    projectId,
    estimateId,
    userId,
  });
  await publishTasksRemapped({
    projectId,
    estimateId,
    userId,
    changedTaskCount: clearedTaskCount,
  });
  return { deletedEstimateId: estimateId, clearedTaskCount };
}

export default deleteEstimate;
