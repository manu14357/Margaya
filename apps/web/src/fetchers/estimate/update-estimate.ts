import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function updateEstimate(
  projectId: string,
  estimateId: string,
  name: string,
) {
  const response = await client.estimate[":projectId"][":estimateId"].$put({
    param: { projectId, estimateId },
    json: { name },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default updateEstimate;
