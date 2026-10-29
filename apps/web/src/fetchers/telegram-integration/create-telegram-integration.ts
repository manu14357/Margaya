import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateTelegramIntegrationRequest = InferRequestType<
  (typeof client)["telegram-integration"]["project"][":projectId"]["$post"]
>["json"];

async function createTelegramIntegration(
  projectId: string,
  json: CreateTelegramIntegrationRequest,
) {
  const response = await client["telegram-integration"].project[
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

export default createTelegramIntegration;
