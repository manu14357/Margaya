import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function reorderEstimatePoints(
  projectId: string,
  estimateId: string,
  pointIds: string[],
) {
  const response = await client.estimate[":projectId"][
    ":estimateId"
  ].points.reorder.$put({
    param: { projectId, estimateId },
    json: { pointIds },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default reorderEstimatePoints;
