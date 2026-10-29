import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateGenericWebhookIntegrationRequest = InferRequestType<
  (typeof client)["generic-webhook-integration"]["project"][":projectId"]["$post"]
>["json"];

async function createGenericWebhookIntegration(
  projectId: string,
  json: CreateGenericWebhookIntegrationRequest,
) {
  const response = await client["generic-webhook-integration"].project[
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

export default createGenericWebhookIntegration;
