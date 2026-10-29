import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateMattermostIntegrationRequest = InferRequestType<
  (typeof client)["mattermost-integration"]["project"][":projectId"]["$post"]
>["json"];

async function createMattermostIntegration(
  projectId: string,
  json: CreateMattermostIntegrationRequest,
) {
  const response = await client["mattermost-integration"].project[
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

export default createMattermostIntegration;
