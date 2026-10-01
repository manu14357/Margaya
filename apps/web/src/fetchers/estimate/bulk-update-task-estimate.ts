import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Sets (or with null clears) the estimate of many tasks of one project.
 * Tasks already on that value are left alone; updatedCount says how many
 * changed.
 */
async function bulkUpdateTaskEstimate(
  taskIds: string[],
  estimatePointId: string | null,
) {
  const response = await client.task.bulk.$patch({
    json: { taskIds, operation: "updateEstimate", value: estimatePointId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default bulkUpdateTaskEstimate;
