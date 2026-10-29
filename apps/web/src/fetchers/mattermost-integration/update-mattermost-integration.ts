import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateMattermostIntegrationRequest = InferRequestType<
  (typeof client)["mattermost-integration"]["project"][":projectId"]["$patch"]
>["json"];

async function updateMattermostIntegration(
  projectId: string,
  json: UpdateMattermostIntegrationRequest,
) {
  const response = await client["mattermost-integration"].project[
    ":projectId"
  ].$patch({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateMattermostIntegration;
