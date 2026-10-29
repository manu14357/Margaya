import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateTelegramIntegrationRequest = InferRequestType<
  (typeof client)["telegram-integration"]["project"][":projectId"]["$patch"]
>["json"];

async function updateTelegramIntegration(
  projectId: string,
  json: UpdateTelegramIntegrationRequest,
) {
  const response = await client["telegram-integration"].project[
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

export default updateTelegramIntegration;
