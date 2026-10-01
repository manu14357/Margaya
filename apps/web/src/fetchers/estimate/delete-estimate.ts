import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function deleteEstimate(projectId: string, estimateId: string) {
  const response = await client.estimate[":projectId"][":estimateId"].$delete({
    param: { projectId, estimateId },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default deleteEstimate;
