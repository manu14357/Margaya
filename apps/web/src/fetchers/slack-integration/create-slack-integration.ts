import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateSlackIntegrationRequest = InferRequestType<
  (typeof client)["slack-integration"]["project"][":projectId"]["$post"]
>["json"];

async function createSlackIntegration(
  projectId: string,
  json: CreateSlackIntegrationRequest,
) {
  const response = await client["slack-integration"].project[
    ":projectId"
  ].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createSlackIntegration;
