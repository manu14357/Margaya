import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

export type EstimatePointMapping = {
  fromPointId: string;
  toPointId: string | null;
};

async function activateEstimate(
  projectId: string,
  estimateId: string,
  mapping: EstimatePointMapping[],
) {
  const response = await client.estimate[":projectId"][
    ":estimateId"
  ].activate.$post({
    param: { projectId, estimateId },
    json: { mapping },
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default activateEstimate;
