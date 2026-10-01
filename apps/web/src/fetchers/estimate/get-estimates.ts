import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

async function getEstimates(projectId: string) {
  const response = await client.estimate[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default getEstimates;
