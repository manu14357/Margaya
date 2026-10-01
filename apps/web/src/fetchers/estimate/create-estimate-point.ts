import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function createEstimatePoint(
  projectId: string,
  estimateId: string,
  json: { value: string; position?: number },
) {
  const response = await client.estimate[":projectId"][
    ":estimateId"
  ].points.$post({
    param: { projectId, estimateId },
    json,
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default createEstimatePoint;
