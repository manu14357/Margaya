import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

/** Server totals over up to 5000 tasks of the project. */
async function getEstimateTotals(projectId: string, taskIds: string[]) {
  const response = await client.estimate[":projectId"].totals.$post({
    param: { projectId },
    json: { taskIds },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default getEstimateTotals;
