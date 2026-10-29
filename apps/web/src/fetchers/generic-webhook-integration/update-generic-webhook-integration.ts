import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateGenericWebhookIntegrationRequest = InferRequestType<
  (typeof client)["generic-webhook-integration"]["project"][":projectId"]["$patch"]
>["json"];

async function updateGenericWebhookIntegration(
  projectId: string,
  json: UpdateGenericWebhookIntegrationRequest,
) {
  const response = await client["generic-webhook-integration"].project[
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

export default updateGenericWebhookIntegration;
