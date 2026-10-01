import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function updateEstimatePoint(
  projectId: string,
  estimateId: string,
  pointId: string,
  value: string,
) {
  const response = await client.estimate[":projectId"][":estimateId"].points[
    ":pointId"
  ].$put({
    param: { projectId, estimateId, pointId },
    json: { value },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default updateEstimatePoint;
