import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Sets a task's estimate to a value of the active system, or clears it. */
async function updateTaskEstimate(
  taskId: string,
  estimatePointId: string | null,
) {
  const response = await client.task.estimate[":id"].$put({
    param: { id: taskId },
    json: { estimatePointId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskEstimate;
