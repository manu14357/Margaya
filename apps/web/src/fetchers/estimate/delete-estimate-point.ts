import { client } from "@margaya/libs";
import { toEstimateRequestError } from "./estimate-error";

/**
 * What happens to the tasks on the deleted value: move them to another
 * value, clear their estimate, or neither (only valid when no task uses it;
 * otherwise the API answers 409 with the task count).
 */
export type DeletePointOutcome =
  | { replacementPointId: string }
  | { clear: true }
  | Record<string, never>;

async function deleteEstimatePoint(
  projectId: string,
  estimateId: string,
  pointId: string,
  outcome: DeletePointOutcome = {},
) {
  const query =
    "replacementPointId" in outcome
      ? { replacementPointId: outcome.replacementPointId }
      : "clear" in outcome
        ? { clear: "true" as const }
        : {};
  const response = await client.estimate[":projectId"][":estimateId"].points[
    ":pointId"
  ].$delete({
    param: { projectId, estimateId, pointId },
    query,
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default deleteEstimatePoint;
