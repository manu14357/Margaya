import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { toEstimateRequestError } from "./estimate-error";

export type CreateEstimateRequest = InferRequestType<
  (typeof client)["estimate"][":projectId"]["$post"]
>["json"];

async function createEstimate(projectId: string, json: CreateEstimateRequest) {
  const response = await client.estimate[":projectId"].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw await toEstimateRequestError(response);
  }

  return response.json();
}

export default createEstimate;
