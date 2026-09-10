import { eq } from "drizzle-orm";
import { estimateTable } from "../../database/schema";
import { getEstimateResponse, requireEstimate } from "../queries";
import { estimateWrite, lockProjectEstimates } from "../write";
import { assertNameAvailable, publishEstimateEvent } from "./shared";

/** Renames a system. The type can't change: create another system instead. */
async function updateEstimate({
  projectId,
  estimateId,
  userId,
  name,
}: {
  projectId: string;
  estimateId: string;
  userId: string;
  name: string;
}) {
  const { response, changed } = await estimateWrite(async (tx) => {
    await lockProjectEstimates(tx, projectId);
    const estimate = await requireEstimate(tx, projectId, estimateId);
    const changed = estimate.name !== name;
    if (changed) {
      await assertNameAvailable(tx, projectId, name, estimateId);
      await tx
        .update(estimateTable)
        .set({ name })
        .where(eq(estimateTable.id, estimateId));
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

export default updateEstimate;
