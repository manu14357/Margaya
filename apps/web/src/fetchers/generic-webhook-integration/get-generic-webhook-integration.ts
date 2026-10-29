import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type GenericWebhookIntegration = NonNullable<
  InferResponseType<
    (typeof client)["generic-webhook-integration"]["project"][":projectId"]["$get"],
    200
  >
>;

async function getGenericWebhookIntegration(
  projectId: string,
): Promise<GenericWebhookIntegration | null> {
  const response = await client["generic-webhook-integration"].project[
    ":projectId"
  ].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getGenericWebhookIntegration;
